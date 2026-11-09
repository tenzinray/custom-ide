/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../../../base/common/async.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../../../base/common/resources.js';
import { localize } from '../../../../../../nls.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IHostService } from '../../../../../services/host/browser/host.js';
import { IPathService } from '../../../../../services/path/common/pathService.js';
import { getGitRepositoriesDirectory, GitRepository, listGitRepositories } from '../../../../workspace/browser/gitRepositories.js';
import { ProjectsSearch } from './header/ProjectsSearch.js';
import { ProjectsList } from './body/ProjectsList.js';

/** Owns project discovery, filter state, refresh coordination, and normal workbench folder opening. */
export class ProjectsContainer extends Disposable {
	private readonly search: ProjectsSearch;
	private readonly body: ProjectsList;
	private repos: GitRepository[] = [];
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
	) {
		super();
		const shell = append(parent, $('.explorer-projects'));
		this.search = this._register(new ProjectsSearch(shell, () => this.body.focusFirst(), () => this.body.openFirst()));
		this.body = this._register(instantiationService.createInstance(ProjectsList, shell, (repo, newWindow) => { void this.open(repo, newWindow); }));
		this._register(this.search.input.onDidChange(() => this.render()));
		this._register(workspace.onDidChangeWorkspaceFolders(() => this.render()));
		const watcher = this._register(fileService.createWatcher(getGitRepositoriesDirectory(pathService.userHome({ preferLocal: true })), { recursive: false, excludes: [] }));
		this._register(watcher.onDidChange(() => this.refreshScheduler.schedule()));
		this.render();
		void this.refresh();
	}

	async refresh(): Promise<void> {
		const generation = ++this.refreshGeneration;
		try {
			const repos = await listGitRepositories(this.pathService.userHome({ preferLocal: true }), this.fileService);
			if (generation !== this.refreshGeneration || this._store.isDisposed) { return; }
			this.repos = repos;
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
		const matches = this.repos.filter(repo => repo.name.toLocaleLowerCase().includes(query));
		const message = this.loading ? localize('projects.loading', "Finding projects…")
			: this.failed ? localize('projects.failed', "Could not read projects in Documents/VSCode.")
				: matches.length ? '' : query ? localize('projects.noMatches', "No matching projects.")
					: localize('projects.empty', "No Git repositories found in Documents/VSCode.");
		this.body.setEntries(matches, this.workspace.getWorkspace().folders.map(folder => folder.uri), message);
	}

	private async open(repo: GitRepository, newWindow: boolean): Promise<void> {
		const folders = this.workspace.getWorkspace().folders;
		if (!newWindow && folders.length === 1 && isEqual(folders[0].uri, repo.folderUri)) { return; }
		try { await this.hostService.openWindow([{ folderUri: repo.folderUri }], { forceNewWindow: newWindow, forceReuseWindow: !newWindow }); }
		catch (error) { this.notificationService.error(error instanceof Error ? error : String(error)); }
	}

	focus(): void { this.search.focus(); }
	layout(height: number, width: number): void { this.body.layout(height - 38, width); }
}
