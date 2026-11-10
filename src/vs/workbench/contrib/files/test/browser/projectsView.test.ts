/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { $, append } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { IFileDialogService, IPickAndOpenOptions } from '../../../../../platform/dialogs/common/dialogs.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { isFolderToOpen, isWorkspaceToOpen } from '../../../../../platform/window/common/window.js';
import { IWorkspaceContextService, Workspace } from '../../../../../platform/workspace/common/workspace.js';
import { getProjectsDirectory, getSavedWorkspacesDirectory } from '../../../../../platform/workspaces/common/projectDirectories.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { TestPathService, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { ProjectsContainer } from '../../browser/views/projects/ProjectsContainer.js';

suite('Explorer Projects', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	async function setup() {
		const home = URI.file('/projects-test');
		const fileService = store.add(new FileService(new NullLogService()));
		store.add(fileService.registerProvider('file', store.add(new InMemoryFileSystemProvider())));
		const root = getProjectsDirectory(home);
		const workspaceDirectory = getSavedWorkspacesDirectory(home);
		await fileService.createFolder(joinPath(root, 'zebra', '.git'));
		await fileService.createFolder(joinPath(root, 'alpha'));
		await fileService.writeFile(joinPath(root, 'alpha', '.git'), VSBuffer.fromString('gitdir: /worktree/alpha'));
		await fileService.createFolder(joinPath(root, 'not-a-repo'));
		await fileService.createFolder(joinPath(root, 'not-a-repo', 'nested', '.git'));
		const instantiation = workbenchInstantiationService({ fileService: () => fileService, pathService: () => new TestPathService(home) }, store);
		const calls: Parameters<IHostService['openWindow']>[] = [];
		instantiation.stub(IHostService, 'openWindow', async (...args: Parameters<IHostService['openWindow']>) => { calls.push(args); });
		const parent = append(mainWindow.document.body, $('div'));
		store.add(toDisposable(() => parent.remove()));
		const projects = store.add(instantiation.createInstance(ProjectsContainer, parent));
		projects.layout(220, 300);
		await projects.refresh();
		const search = parent.querySelector('input')!;
		const names = () => [...parent.querySelectorAll('.explorer-project-name')].map(row => row.textContent);
		const filter = (value: string) => { search.value = value; search.dispatchEvent(new mainWindow.Event('input', { bubbles: true })); };
		return { projects, parent, search, names, filter, calls, root, workspaceDirectory, fileService, instantiation };
	}

	test('lists direct repositories alphabetically, including Git worktrees', async () => {
		const { names } = await setup();
		assert.deepStrictEqual(names(), ['alpha', 'zebra']);
	});

	test('lists saved workspaces first with distinct icons and ignores unrelated files', async () => {
		const { projects, parent, names, workspaceDirectory, fileService } = await setup();
		await fileService.createFolder(workspaceDirectory);
		for (const name of ['zeta.code-workspace', 'main-ws.code-workspace', 'notes.txt']) {
			await fileService.writeFile(joinPath(workspaceDirectory, name), VSBuffer.fromString('{"folders":[]}'));
		}
		await fileService.createFolder(joinPath(workspaceDirectory, 'directory.code-workspace'));
		await projects.refresh();
		assert.deepStrictEqual({ names: names(), icons: [...parent.querySelectorAll('.explorer-project-row > .codicon')].map(icon => icon.className) }, {
			names: ['main-ws', 'zeta', 'alpha', 'zebra'],
			icons: ['codicon codicon-root-folder', 'codicon codicon-root-folder', 'codicon codicon-repo', 'codicon codicon-repo'],
		});
	});

	test('filters saved workspaces and opens the workspace rather than its file', async () => {
		const { projects, search, filter, calls, workspaceDirectory, fileService } = await setup();
		const uri = joinPath(workspaceDirectory, 'main-ws.code-workspace');
		await fileService.createFolder(workspaceDirectory);
		await fileService.writeFile(uri, VSBuffer.fromString('{"folders":[]}'));
		await projects.refresh();
		filter('main-ws');
		search.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		assert.deepStrictEqual(calls.map(([resources, options]) => [resources.map(resource => isWorkspaceToOpen(resource) ? resource.workspaceUri.toString() : ''), options]), [
			[[uri.toString()], { forceNewWindow: false, forceReuseWindow: true }],
		]);
	});

	test('does not reload the current workspace when its row is opened again', async () => {
		const { projects, search, filter, calls, workspaceDirectory, fileService, instantiation } = await setup();
		const uri = joinPath(workspaceDirectory, 'main-ws.code-workspace');
		await fileService.createFolder(workspaceDirectory);
		await fileService.writeFile(uri, VSBuffer.fromString('{"folders":[]}'));
		instantiation.stub(IWorkspaceContextService, 'getWorkspace', () => new Workspace('main-ws-test', [], false, uri, () => false));
		await projects.refresh();
		filter('main-ws');
		search.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		assert.strictEqual(calls.length, 0);
	});

	test('refresh removes deleted workspace files without hiding repositories', async () => {
		const { projects, names, workspaceDirectory, fileService } = await setup();
		const uri = joinPath(workspaceDirectory, 'main-ws.code-workspace');
		await fileService.createFolder(workspaceDirectory);
		await fileService.writeFile(uri, VSBuffer.fromString('{"folders":[]}'));
		await projects.refresh();
		const before = names();
		await fileService.del(uri);
		await projects.refresh();
		assert.deepStrictEqual({ before, after: names() }, { before: ['main-ws', 'alpha', 'zebra'], after: ['alpha', 'zebra'] });
	});

	test('keeps Select from Finder below the list even when no projects match', async () => {
		const { parent, filter, instantiation } = await setup();
		const pending = new DeferredPromise<void>();
		const calls: IPickAndOpenOptions[] = [];
		instantiation.stub(IFileDialogService, 'pickFolderAndOpen', async (options: IPickAndOpenOptions) => { calls.push(options); await pending.p; });
		filter('not-listed');
		const button = parent.querySelector<HTMLButtonElement>('.explorer-projects-select-folder')!;
		assert.strictEqual(button.parentElement?.previousElementSibling?.className, 'explorer-projects-body');
		button.click();
		button.click();
		assert.deepStrictEqual({ text: button.textContent, disabled: button.disabled, calls }, {
			text: 'Select from Finder', disabled: true, calls: [{ forceNewWindow: false, availableFileSystems: ['file'] }],
		});
		await pending.complete();
		await timeout(0);
		assert.strictEqual(button.disabled, false);
	});

	test('keeps the search field free of a decorative icon', async () => {
		const { parent } = await setup();
		assert.strictEqual(parent.querySelector('.explorer-projects-search .codicon'), null);
	});

	test('filters projects and restores the list when Escape clears search', async () => {
		const { names, search, filter } = await setup();
		filter(' ZE ');
		const filtered = names();
		search.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		assert.deepStrictEqual({ filtered, restored: names(), value: search.value }, { filtered: ['zebra'], restored: ['alpha', 'zebra'], value: '' });
	});

	test('focuses search and opens the filtered repository in the same window', async () => {
		const { projects, search, filter, calls, root } = await setup();
		projects.focus();
		const focused = mainWindow.document.activeElement === search;
		filter('zebra');
		search.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		assert.deepStrictEqual({ focused, calls: calls.map(([resources, options]) => [resources.map(resource => isFolderToOpen(resource) ? resource.folderUri.toString() : ''), options]) }, {
			focused: true, calls: [[[joinPath(root, 'zebra').toString()], { forceNewWindow: false, forceReuseWindow: true }]],
		});
	});

	test('shows an explicit no-match message and refreshes new repositories', async () => {
		const { projects, parent, filter, names, root, fileService } = await setup();
		filter('missing');
		const message = parent.querySelector('.explorer-projects-message')?.textContent;
		await fileService.createFolder(joinPath(root, 'beta', '.git'));
		await projects.refresh();
		filter('');
		assert.deepStrictEqual({ message, names: names() }, { message: 'No matching projects.', names: ['alpha', 'beta', 'zebra'] });
	});
});
