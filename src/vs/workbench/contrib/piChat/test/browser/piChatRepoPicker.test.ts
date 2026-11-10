/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, append } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { IFileDialogService, IOpenDialogOptions } from '../../../../../platform/dialogs/common/dialogs.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceContextService, toWorkspaceFolder, Workspace } from '../../../../../platform/workspace/common/workspace.js';
import { getProjectsDirectory } from '../../../../../platform/workspaces/common/projectDirectories.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { TestPathService, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { PiChatCreatedSession } from '../../common/pi-chat-run-types.js';
import { PiChatSessionSummary } from '../../common/pi-chat-types.js';
import { PiChatInputCacheService } from '../../browser/PiChatInputCacheService.js';
import { PiChatRepoPickerContainer } from '../../browser/PiChatRepoPickerContainer.js';
import { IPiChatSelectionService } from '../../browser/PiChatSelectionService.js';
import { PiChatRepoPickerBody } from '../../browser/body/PiChatRepoPickerBody.js';
import { PiChatBodyScroll } from '../../browser/body/PiChatBodyScroll.js';

suite('Pi chat repo picker', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const alpha = { name: 'alpha', folderUri: URI.file('/repos/alpha') };
	const zebra = { name: 'zebra', folderUri: URI.file('/repos/zebra') };

	function parent() {
		const element = append(mainWindow.document.body, $('div'));
		store.add(toDisposable(() => element.remove()));
		return element;
	}

	test('uses one workspace caption and the same repo rows as the full list', () => {
		const element = parent();
		const body = store.add(new PiChatRepoPickerBody(element, () => { }, () => { }));
		body.setRepos([alpha, zebra], [alpha], undefined);
		assert.deepStrictEqual({
			captions: [...element.querySelectorAll('.pi-chat-repo-caption')].map(e => e.textContent),
			names: [...element.querySelectorAll('.pi-chat-repo-item strong')].map(e => e.textContent),
			classes: [...element.querySelectorAll('.pi-chat-repo-item')].map(e => e.className),
		}, { captions: ['Current workspace', 'All repositories'], names: ['alpha', 'alpha', 'zebra'], classes: ['pi-chat-repo-item', 'pi-chat-repo-item', 'pi-chat-repo-item'] });
	});

	test('groups workspace and other repos under a single results scroller', () => {
		const element = parent();
		const body = store.add(new PiChatRepoPickerBody(element, () => { }, () => { }));
		body.setRepos([alpha, zebra], [alpha], undefined);
		const results = element.querySelector('.pi-chat-repo-results')!;
		assert.deepStrictEqual({
			workspaceInside: !!results.querySelector('.pi-chat-repo-suggestions .pi-chat-repo-workspace'),
			allInside: !!results.querySelector('.pi-chat-repo-list'),
			searchInside: !!results.querySelector('input'),
			workspaceRows: results.querySelector('.pi-chat-repo-workspace strong')?.textContent,
		}, { workspaceInside: true, allInside: true, searchInside: false, workspaceRows: 'alpha' });
	});

	test('search filters both workspace suggestions and all repos and Enter selects the match', () => {
		const element = parent();
		const selected: string[] = [];
		const body = store.add(new PiChatRepoPickerBody(element, repo => selected.push(repo.name), () => { }));
		body.setRepos([alpha, zebra], [alpha], undefined);
		const search = element.querySelector('input')!;
		search.value = ' ZE ';
		search.dispatchEvent(new mainWindow.Event('input'));
		search.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Enter' }));
		assert.deepStrictEqual({ captions: [...element.querySelectorAll('.pi-chat-repo-caption')].map(e => e.textContent), names: [...element.querySelectorAll('strong')].map(e => e.textContent), selected }, {
			captions: ['All repositories'], names: ['zebra'], selected: ['zebra'],
		});
	});

	test('busy selection stays disabled across searches without locking the search field', () => {
		const element = parent();
		const body = store.add(new PiChatRepoPickerBody(element, () => { }, () => { }));
		body.setRepos([alpha, zebra], [alpha], undefined);
		body.setBusy(true);
		const search = element.querySelector('input')!;
		search.dispatchEvent(new mainWindow.Event('input'));
		assert.deepStrictEqual({ busy: body.element.getAttribute('aria-busy'), buttons: [...element.querySelectorAll('button')].map(e => e.disabled), searchDisabled: search.disabled }, {
			busy: 'true', buttons: [true, true, true, true], searchDisabled: false,
		});
	});

	test('keyboard navigation crosses all sections without scrolling instead of moving focus', () => {
		const element = parent();
		const body = store.add(new PiChatRepoPickerBody(element, () => { }, () => { }));
		body.setRepos([alpha, zebra], [alpha], zebra);
		const search = element.querySelector('input')!;
		const buttons = [...element.querySelectorAll('.pi-chat-repo-item')];
		const focused: number[] = [];
		search.focus();
		for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp']) {
			const event = new mainWindow.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
			mainWindow.document.activeElement!.dispatchEvent(event);
			assert.strictEqual(event.defaultPrevented, true);
			focused.push(buttons.indexOf(mainWindow.document.activeElement!));
		}
		assert.deepStrictEqual(focused, [0, 1, 2, 3, 3, 2, 1, 0, -1, 3]);
	});

	test('keeps Open Finder after all repositories across filtering and discovery errors', () => {
		const element = parent();
		let opened = 0;
		const body = store.add(new PiChatRepoPickerBody(element, () => { }, () => { opened++; }));
		body.setRepos([alpha, zebra], [alpha], undefined);
		const button = element.querySelector<HTMLButtonElement>('.pi-chat-repo-open-folder')!;
		const search = element.querySelector('input')!;
		search.value = 'missing';
		search.dispatchEvent(new mainWindow.Event('input'));
		assert.strictEqual(button.parentElement?.lastElementChild, button);
		assert.strictEqual(button.previousElementSibling?.className, 'pi-chat-repo-list');
		body.setError();
		button.click();
		assert.strictEqual(opened, 1);
	});

	test('workspace heading is outside the tinted repo card', () => {
		const element = parent();
		const body = store.add(new PiChatRepoPickerBody(element, () => { }, () => { }));
		body.setRepos([alpha], [alpha], undefined);
		assert.deepStrictEqual({
			captionInside: !!element.querySelector('.pi-chat-repo-workspace .pi-chat-repo-caption'),
			workspaceRows: element.querySelectorAll('.pi-chat-repo-workspace .pi-chat-repo-item').length,
		}, { captionInside: false, workspaceRows: 1 });
	});

	test('Open Finder accepts a non-repo folder and cancellation does not create a chat', async () => {
		const instantiation = workbenchInstantiationService(undefined, store);
		let selected: PiChatSessionSummary | undefined;
		instantiation.set(IPiChatSelectionService, upcastPartial<IPiChatSelectionService>({ selectSession: session => { selected = session; } }));
		instantiation.stub(IViewsService, {});
		instantiation.stub(IViewsService, 'openView', async () => undefined);
		const commands: string[] = [];
		instantiation.stub(ICommandService, {});
		instantiation.stub(ICommandService, 'executeCommand', async (_id: string, folder: string) => {
			commands.push(folder);
			return { id: 'folder-draft', sessionFile: '/sessions/folder-draft.jsonl' };
		});
		let result: URI[] | undefined = undefined;
		let options: IOpenDialogOptions | undefined;
		instantiation.stub(IFileDialogService, {});
		instantiation.stub(IFileDialogService, 'showOpenDialog', async (value: IOpenDialogOptions) => { options = value; return result; });
		const element = parent();
		store.add(instantiation.createInstance(PiChatRepoPickerContainer, element, undefined));
		const button = element.querySelector<HTMLButtonElement>('.pi-chat-repo-open-folder')!;
		button.click();
		await timeout(0);
		assert.deepStrictEqual(commands, []);
		result = [URI.file('/notes/not-a-repository')];
		button.click();
		await timeout(0);
		assert.deepStrictEqual({
			commands, selected: selected && [selected.repoName, selected.repoPath, selected.isDraft],
			folders: options?.canSelectFolders, files: options?.canSelectFiles, multiple: options?.canSelectMany,
		}, { commands: [result[0].fsPath], selected: ['not-a-repository', result[0].fsPath, true], folders: true, files: false, multiple: false });
	});

	test('empty repo selection does not auto-follow or show transcript scrolling controls', () => {
		const shell = parent();
		const body = append(shell, $('div', { style: 'height:100px;overflow:auto' }));
		append(body, $('div', { style: 'height:800px' }));
		const scroll = store.add(new PiChatBodyScroll(shell, body));
		scroll.setEnabled(false);
		body.scrollTop = 200;
		body.dispatchEvent(new mainWindow.Event('scroll'));
		scroll.afterRender(true, 0);
		assert.deepStrictEqual({ top: body.scrollTop, jumpHidden: shell.querySelector<HTMLButtonElement>('button')?.hidden }, { top: 200, jumpHidden: true });
	});

	test('discovery and new-chat creation share the canonical draft cache and selection', async () => {
		const home = URI.file('/picker-home');
		const files = store.add(new FileService(new NullLogService()));
		store.add(files.registerProvider('file', store.add(new InMemoryFileSystemProvider())));
		const root = getProjectsDirectory(home);
		await files.createFolder(joinPath(root, 'alpha', '.git'));
		await files.createFolder(joinPath(root, 'zebra', '.git'));
		await files.createFolder(joinPath(root, 'workouts'));
		await files.createFolder(joinPath(home, '.pi', '.git'));
		const instantiation = workbenchInstantiationService({ fileService: () => files, pathService: () => new TestPathService(home) }, store);
		instantiation.stub(IWorkspaceContextService, 'getWorkspace', () => new Workspace('picker-test', [toWorkspaceFolder(joinPath(root, 'alpha')), toWorkspaceFolder(joinPath(root, 'workouts'))], false, null, () => false));
		let selected: PiChatSessionSummary | undefined;
		instantiation.set(IPiChatSelectionService, upcastPartial<IPiChatSelectionService>({ selectSession: session => { selected = session; } }));
		const opened: string[] = [];
		instantiation.stub(IViewsService, {});
		instantiation.stub(IViewsService, 'openView', async (id: string) => { opened.push(id); });
		const pending = new DeferredPromise<PiChatCreatedSession>();
		let commands = 0;
		instantiation.stub(ICommandService, {});
		instantiation.stub(ICommandService, 'executeCommand', async () => { commands++; return pending.p; });
		const element = parent();
		let closed = 0;
		const picker = store.add(instantiation.createInstance(PiChatRepoPickerContainer, element, () => { closed++; }));
		await picker.refresh();
		assert.deepStrictEqual([...element.querySelectorAll('.pi-chat-repo-suggestions strong')].map(e => e.textContent), ['alpha', 'workouts']);
		assert.ok([...element.querySelectorAll('.pi-chat-repo-item')].some(row => row.textContent?.includes('.pi')));
		const first = element.querySelector<HTMLButtonElement>('.pi-chat-repo-item')!;
		first.click();
		first.click();
		await pending.complete({ id: 'new-draft', sessionFile: '/sessions/new-draft.jsonl' });
		await timeout(0);
		const cached = instantiation.createInstance(PiChatInputCacheService).getDraftSession();
		assert.deepStrictEqual({ commands, closed, selected: selected && [selected.id, selected.repoName, selected.repoPath, selected.isDraft], cached: cached?.id, opened }, {
			commands: 1, closed: 1, selected: ['new-draft', 'alpha', joinPath(root, 'alpha').fsPath, true], cached: 'new-draft', opened: ['workbench.view.piChatConversation'],
		});
	});
});
