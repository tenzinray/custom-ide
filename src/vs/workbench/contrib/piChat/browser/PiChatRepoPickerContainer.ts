/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename, dirname, isEqual, isEqualOrParent, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IPathService } from '../../../../platform/path/common/pathService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { GitRepository, listGitRepositories } from '../../workspace/browser/gitRepositories.js';
import { PiChatSessionSummary } from '../common/pi-chat-types.js';
import { PiChatConversationView } from './PiChatConversationView.js';
import { PiChatSessionCreationService } from './PiChatSessionCreationService.js';
import { PiChatSessionListService } from './PiChatSessionListService.js';
import { IPiChatSelectionService, PiChatSessionOpenOptions } from './PiChatSelectionService.js';
import { PiChatRepoPickerBody } from './body/PiChatRepoPickerBody.js';

/** Shared popup/empty-state coordinator for recent-session paging, repository discovery, and chat selection. */
export class PiChatRepoPickerContainer extends Disposable {
	private readonly body: PiChatRepoPickerBody;
	sessionOpenOptions: PiChatSessionOpenOptions = {};
	private readonly creation: PiChatSessionCreationService;
	private readonly sessionListService: PiChatSessionListService;
	private sessionLimit = PiChatSessionListService.initialLimit;
	private sessionRequestId = 0;
	private loadingSessions = false;
	private requestId = 0;
	private creating = false;

	constructor(parent: HTMLElement, private readonly onCreated: (() => void) | undefined,
		@IInstantiationService instantiationService: IInstantiationService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IEditorService private readonly editors: IEditorService,
		@IFileService private readonly files: IFileService,
		@IPathService private readonly paths: IPathService,
		@IPiChatSelectionService private readonly selection: IPiChatSelectionService,
		@IViewsService private readonly views: IViewsService,
		@INotificationService private readonly notifications: INotificationService,
		@IFileDialogService private readonly dialogs: IFileDialogService,
	) {
		super();
		this.creation = instantiationService.createInstance(PiChatSessionCreationService);
		this.sessionListService = instantiationService.createInstance(PiChatSessionListService);
		this.body = this._register(new PiChatRepoPickerBody(parent, repo => { void this.createDraft(repo); }, () => { void this.openFolder(); },
			session => { if (!this.creating) { this.selectSession(session); } },
			() => {
				if (this.loadingSessions || this.creating) { return; }
				this.sessionLimit += PiChatSessionListService.pageSize;
				void this.refreshSessions();
			}));
		this.sessionListService.onDidChangeSummaries(this._store, () => { void this.refreshSessions(); });
		this._register(workspace.onDidChangeWorkspaceFolders(() => { void this.refresh(); }));
		void this.refresh();
	}

	focus(): void { this.body.focus(); }

	async refresh(): Promise<void> {
		await Promise.all([this.refreshSessions(), this.refreshRepos()]);
	}

	private async refreshSessions(): Promise<void> {
		const requestId = ++this.sessionRequestId;
		this.loadingSessions = true;
		this.body.setSessionsLoading(true);
		try {
			const { sessions, hasMore } = await this.sessionListService.listSessions(this.sessionLimit);
			if (this._store.isDisposed || requestId !== this.sessionRequestId) { return; }
			this.body.setSessions(sessions, hasMore);
		} catch (error) {
			if (!this._store.isDisposed && requestId === this.sessionRequestId) {
				this.body.setSessions([], false);
				this.notifications.error(error);
			}
		} finally {
			if (!this._store.isDisposed && requestId === this.sessionRequestId) {
				this.loadingSessions = false;
				this.body.setSessionsLoading(false);
			}
		}
	}

	private selectSession(session: PiChatSessionSummary): void {
		if (this._store.isDisposed) { return; }
		this.selection.selectSession(session, this.sessionOpenOptions);
		this.onCreated?.();
		void this.views.openView(PiChatConversationView.ID, true).catch(error => this.notifications.error(error));
	}

	private async refreshRepos(): Promise<void> {
		const requestId = ++this.requestId;
		const workspaceFolders = this.workspace.getWorkspace().folders.map(folder => folder.uri);
		const editorResource = this.editors.activeEditor?.resource;
		const candidates = [...workspaceFolders];
		let editorFolder = editorResource?.scheme === 'file' ? dirname(editorResource) : undefined;
		for (let depth = 0; editorFolder && depth < 12 && !candidates.some(folder => isEqual(folder, editorFolder)); depth++) {
			candidates.push(editorFolder);
			const parent = dirname(editorFolder);
			if (isEqual(parent, editorFolder)) { break; }
			editorFolder = parent;
		}
		try {
			const [discovered, nearby] = await Promise.all([
				listGitRepositories(this.paths.userHome({ preferLocal: true }), this.files).catch(() => []),
				Promise.all(candidates.filter(folder => folder.scheme === 'file').map(async folder =>
					await this.files.exists(joinPath(folder, '.git')) ? { name: basename(folder), folderUri: folder } : undefined)),
			]);
			if (this._store.isDisposed || requestId !== this.requestId) { return; }
			// Workspace folders are valid chat working directories even without Git metadata.
			const workspaceEntries = workspaceFolders.filter(folder => folder.scheme === 'file').map(folder => ({ name: basename(folder), folderUri: folder }));
			const repos = [...new Map([...discovered, ...workspaceEntries, ...nearby.filter(repo => repo !== undefined)].map(repo => [repo.folderUri.toString(), repo])).values()]
				.sort((a, b) => a.name.localeCompare(b.name));
			const findRepo = (resource: URI) => repos.filter(repo => isEqualOrParent(resource, repo.folderUri)).sort((a, b) => b.folderUri.path.length - a.folderUri.path.length)[0];
			const workspaceRepos = [...new Set(workspaceFolders.map(findRepo).filter(repo => repo !== undefined))];
			const editorRepo = editorResource ? findRepo(editorResource) : undefined;
			this.body.setRepos(repos, workspaceRepos, editorRepo && !workspaceRepos.includes(editorRepo) ? editorRepo : undefined);
		} catch { if (!this._store.isDisposed && requestId === this.requestId) { this.body.setError(); } }
	}

	private async openFolder(): Promise<void> {
		if (this.creating || this._store.isDisposed) { return; }
		this.creating = true;
		this.body.setBusy(true);
		let folder: URI | undefined;
		try {
			folder = (await this.dialogs.showOpenDialog({
				title: localize('piChat.chooseChatFolder', "Choose a Folder for Chat"),
				openLabel: localize('piChat.selectChatFolder', "Select Folder"),
				canSelectFolders: true,
				canSelectFiles: false,
				canSelectMany: false,
				availableFileSystems: ['file'],
				defaultUri: await this.paths.userHome({ preferLocal: true }),
			}))?.[0];
		} catch (error) { if (!this._store.isDisposed) { this.notifications.error(error); } }
		finally { this.creating = false; if (!this._store.isDisposed) { this.body.setBusy(false); } }
		if (folder) { await this.createDraft({ name: basename(folder), folderUri: folder }); }
	}

	private async createDraft(repo: GitRepository): Promise<void> {
		if (this.creating || this._store.isDisposed) { return; }
		this.creating = true;
		this.body.setBusy(true);
		try {
			const draft = await this.creation.createDraft(repo.folderUri);
			if (!draft || this._store.isDisposed) { return; }
			this.selectSession(draft);
		} catch (error) { if (!this._store.isDisposed) { this.notifications.error(error); } }
		finally { this.creating = false; if (!this._store.isDisposed) { this.body.setBusy(false); } }
	}
}
