/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename, dirname, isEqual, isEqualOrParent, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IPathService } from '../../../../platform/path/common/pathService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { GitRepository, listGitRepositories } from '../../workspace/browser/gitRepositories.js';
import { PiChatCreatedSession } from '../common/pi-chat-run-types.js';
import { PiChatSessionSummary } from '../common/pi-chat-types.js';
import { PiChatConversationView } from './PiChatConversationView.js';
import { PiChatInputCacheService } from './PiChatInputCacheService.js';
import { IPiChatSelectionService } from './PiChatSelectionService.js';
import { PiChatRepoPickerBody } from './body/PiChatRepoPickerBody.js';

/** One new-chat flow for the popup and inline empty state: discovery, draft creation, and selection. */
export class PiChatRepoPickerContainer extends Disposable {
	private readonly body: PiChatRepoPickerBody;
	private readonly inputCache: PiChatInputCacheService;
	private requestId = 0;
	private creating = false;

	constructor(parent: HTMLElement, private readonly onCreated: (() => void) | undefined,
		@IInstantiationService instantiationService: IInstantiationService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IEditorService private readonly editors: IEditorService,
		@IFileService private readonly files: IFileService,
		@IPathService private readonly paths: IPathService,
		@ICommandService private readonly commands: ICommandService,
		@IPiChatSelectionService private readonly selection: IPiChatSelectionService,
		@IViewsService private readonly views: IViewsService,
		@INotificationService private readonly notifications: INotificationService,
	) {
		super();
		this.inputCache = instantiationService.createInstance(PiChatInputCacheService);
		this.body = this._register(new PiChatRepoPickerBody(parent, repo => { void this.createDraft(repo); }));
		this._register(workspace.onDidChangeWorkspaceFolders(() => { void this.refresh(); }));
		void this.refresh();
	}

	focus(): void { this.body.focus(); }

	async refresh(): Promise<void> {
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

	private async createDraft(repo: GitRepository): Promise<void> {
		if (this.creating || this._store.isDisposed) { return; }
		this.creating = true;
		this.body.setBusy(true);
		try {
			const created = await this.commands.executeCommand<PiChatCreatedSession>('piChat.createSession', repo.folderUri.fsPath);
			if (!created || this._store.isDisposed) { return; }
			const draft: PiChatSessionSummary = { id: created.id, repoName: repo.name, repoPath: repo.folderUri.fsPath, lastMessageAt: new Date().toISOString(), sessionFile: URI.file(created.sessionFile), isDraft: true };
			this.inputCache.setDraftSession(draft);
			this.selection.selectSession(draft);
			this.onCreated?.();
			void this.views.openView(PiChatConversationView.ID, true).catch(error => this.notifications.error(error));
		} catch (error) { if (!this._store.isDisposed) { this.notifications.error(error); } }
		finally { this.creating = false; if (!this._store.isDisposed) { this.body.setBusy(false); } }
	}
}
