/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../../../base/common/async.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../../../base/common/resources.js';
import { localize } from '../../../../../../nls.js';
import { IFileDialogService } from '../../../../../../platform/dialogs/common/dialogs.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { isWorkspaceToOpen } from '../../../../../../platform/window/common/window.js';
import { IWorkspaceContextService, WORKSPACE_SUFFIX, hasWorkspaceFileExtension } from '../../../../../../platform/workspace/common/workspace.js';
import { getProjectsDirectory, getSavedWorkspacesDirectory } from '../../../../../../platform/workspaces/common/projectDirectories.js';
import { IHostService } from '../../../../../services/host/browser/host.js';
import { IPathService } from '../../../../../services/path/common/pathService.js';
import { listGitRepositories } from '../../../../workspace/browser/gitRepositories.js';
import { ProjectEntry } from './project-entry.js';
import { ProjectsSearch } from './header/ProjectsSearch.js';
import { ProjectsList } from './body/ProjectsList.js';
import { ProjectsFooter } from './footer/ProjectsFooter.js';

/** Owns repository/workspace discovery, filtering, refresh, and normal workbench opening. */
export class ProjectsContainer extends Disposable {
	private readonly search: ProjectsSearch;
	private readonly body: ProjectsList;
	private readonly footer: ProjectsFooter;
	private selectingFolder = false;
	private entries: ProjectEntry[] = [];
	private loading = true;
	private failed = false;
	private refreshGeneration = 0;
	private readonly refreshScheduler = this._register(new RunOnceScheduler(() => { void this.refresh(); }, 200));

	constructor(parent: HTMLElement,
		@IInstantiationService instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IHostService private readonly hostService: IHostService,
		@INotificationService private readonly notificationService: INotificationService,
		@IFileDialogService private readonly dialogs: IFileDialogService,
	) {
		super();
		const shell = append(parent, $('.explorer-projects'));
		this.search = this._register(new ProjectsSearch(shell, () => this.body.focusFirst(), () => this.body.openFirst()));
		this.body = this._register(instantiationService.createInstance(ProjectsList, shell, (repo, newWindow) => { void this.open(repo, newWindow); }));
		this.footer = this._register(new ProjectsFooter(shell, () => { void this.selectFolder(); }));
		this._register(this.search.input.onDidChange(() => this.render()));
		this._register(workspace.onDidChangeWorkspaceFolders(() => this.render()));
		const home = pathService.userHome({ preferLocal: true });
		for (const directory of [getProjectsDirectory(home), getSavedWorkspacesDirectory(home)]) {
			const watcher = this._register(fileService.createWatcher(directory, { recursive: false, excludes: [] }));
			this._register(watcher.onDidChange(() => this.refreshScheduler.schedule()));
		}
		this.render();
		void this.refresh();
	}

	async refresh(): Promise<void> {
		const generation = ++this.refreshGeneration;
		try {
			const home = this.pathService.userHome({ preferLocal: true });
			const [repos, directory] = await Promise.all([
				listGitRepositories(home, this.fileService),
				this.fileService.resolve(getSavedWorkspacesDirectory(home)).catch(error => {
					if (toFileOperationResult(error) !== FileOperationResult.FILE_NOT_FOUND) { throw error; }
					return undefined;
				}),
			]);
			if (generation !== this.refreshGeneration || this._store.isDisposed) { return; }
			const workspaces = (directory?.children ?? [])
				.filter(child => child.isFile && hasWorkspaceFileExtension(child.resource))
				.map(child => ({ name: child.name.slice(0, -WORKSPACE_SUFFIX.length), workspaceUri: child.resource }))
				.sort((a, b) => a.name.localeCompare(b.name));
			this.entries = [...workspaces, ...repos];
			this.failed = false;
		} catch {
			if (generation !== this.refreshGeneration || this._store.isDisposed) { return; }
			this.failed = true;
		} finally {
			if (generation === this.refreshGeneration && !this._store.isDisposed) { this.loading = false; this.render(); }
		}
	}

	private render(): void {
		const query = this.search.input.value.trim().toLocaleLowerCase();
		const matches = this.entries.filter(entry => entry.name.toLocaleLowerCase().includes(query));
		const message = this.loading ? localize('projects.loading', "Finding projects…")
			: this.failed ? localize('projects.failed', "Could not read projects or saved workspaces in Documents/VSCode.")
				: matches.length ? '' : query ? localize('projects.noMatches', "No matching projects.")
					: localize('projects.empty', "No repositories or saved workspaces found in Documents/VSCode.");
		const workspace = this.workspace.getWorkspace();
		this.body.setEntries(matches, workspace.folders.map(folder => folder.uri), workspace.configuration ?? undefined, message);
	}

	private async open(entry: ProjectEntry, newWindow: boolean): Promise<void> {
		const workspace = this.workspace.getWorkspace();
		const resource = isWorkspaceToOpen(entry) ? { workspaceUri: entry.workspaceUri } : { folderUri: entry.folderUri };
		const alreadyOpen = isWorkspaceToOpen(entry) ? isEqual(workspace.configuration ?? undefined, entry.workspaceUri)
			: workspace.folders.length === 1 && !workspace.configuration && isEqual(workspace.folders[0].uri, entry.folderUri);
		if (!newWindow && alreadyOpen) { return; }
		try { await this.hostService.openWindow([resource], { forceNewWindow: newWindow, forceReuseWindow: !newWindow }); }
		catch (error) { this.notificationService.error(error instanceof Error ? error : String(error)); }
	}

	private async selectFolder(): Promise<void> {
		if (this.selectingFolder || this._store.isDisposed) { return; }
		this.selectingFolder = true;
		this.footer.setBusy(true);
		try { await this.dialogs.pickFolderAndOpen({ forceNewWindow: false, availableFileSystems: ['file'] }); }
		catch (error) { if (!this._store.isDisposed) { this.notificationService.error(error instanceof Error ? error : String(error)); } }
		finally { this.selectingFolder = false; if (!this._store.isDisposed) { this.footer.setBusy(false); } }
	}

	focus(): void { this.search.focus(); }
	layout(height: number, width: number): void { this.body.layout(height - 38 - this.footer.element.offsetHeight, width); }
}
