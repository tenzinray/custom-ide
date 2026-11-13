/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { timeout } from '../../../../../base/common/async.js';
import { IAction } from '../../../../../base/common/actions.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IPathService } from '../../../../../platform/path/common/pathService.js';
import { PiChatConversationGroup } from '../../browser/PiChatConversationGroup.js';
import { PiChatSessionListService } from '../../browser/PiChatSessionListService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextMenuService, IContextViewService, IOpenContextView } from '../../../../../platform/contextview/browser/contextView.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { InMemoryStorageService, IStorageService } from '../../../../../platform/storage/common/storage.js';
import { PiChatInputCacheService } from '../../browser/PiChatInputCacheService.js';
import { PiChatSelectionService, IPiChatSelectionService } from '../../browser/PiChatSelectionService.js';
import { PiChatSessionRenameService } from '../../browser/PiChatSessionRenameService.js';
import { PiChatSessionSummary } from '../../common/pi-chat-types.js';

suite('PiChatSessionRename', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const session: PiChatSessionSummary = { id: 'chat', repoName: 'repo', repoPath: '/repo', sessionFile: URI.file('/sessions/chat.jsonl'), lastMessageAt: '2026-01-01T00:00:00Z' };
	let host: HTMLElement;
	let label: HTMLElement;
	let rename: PiChatSessionRenameService;
	let selection: PiChatSelectionService;
	let calls: unknown[][];
	let errors: unknown[];
	let fail: boolean;
	let cache: PiChatInputCacheService;
	let instantiation: TestInstantiationService;
	let menuActions: readonly IAction[];

	setup(() => {
		host = mainWindow.document.createElement('div');
		label = mainWindow.document.createElement('span');
		label.textContent = 'repo';
		host.append(label);
		mainWindow.document.body.append(host);
		instantiation = store.add(new TestInstantiationService());
		const storage = store.add(new InMemoryStorageService());
		instantiation.stub(IStorageService, storage);
		cache = new PiChatInputCacheService(storage);
		selection = store.add(new PiChatSelectionService());
		selection.selectSession(session);
		instantiation.stub(IPiChatSelectionService, selection);
		calls = [];
		errors = [];
		fail = false;
		instantiation.stub(ICommandService, new class extends mock<ICommandService>() {
			override async executeCommand<T>(...args: unknown[]): Promise<T> {
				calls.push(args);
				if (fail) { throw new Error('Save failed'); }
				return undefined as T;
			}
		}());
		instantiation.stub(INotificationService, { error: error => { errors.push(error); } });
		instantiation.stub(IContextViewService, new class extends mock<IContextViewService>() {
			override hideContextView(): void { }
			override showContextView(): IOpenContextView { return { close: () => {} }; }
		}());
		menuActions = [];
		instantiation.stub(IContextMenuService, { onDidHideContextMenu: Event.None, showContextMenu: delegate => { menuActions = delegate.getActions?.() ?? []; } });
		rename = store.add(instantiation.createInstance(PiChatSessionRenameService));
	});

	teardown(() => host.remove());

	function input(): HTMLInputElement { return label.querySelector('input')!; }
	function key(key: string): void { input().dispatchEvent(new KeyboardEvent('keydown', { key, keyCode: key === 'Enter' ? 13 : 27, bubbles: true, cancelable: true })); }

	test('uses Explorer inline editing with selected title, Enter saves native metadata without changing focus to another chat', async () => {
		rename.begin(session, label);
		const initial = { value: input().value, start: input().selectionStart, end: input().selectionEnd, focused: mainWindow.document.activeElement === input() };
		input().value = '  New title  ';
		key('Enter');
		await timeout(0);
		assert.deepStrictEqual({ initial, calls, name: selection.selectedSession?.sessionName, repo: selection.selectedSession?.repoName, editing: rename.isEditing, inputs: label.querySelectorAll('input').length, errors }, {
			initial: { value: 'repo', start: 0, end: 4, focused: true }, calls: [['piChat.renameSession', 'chat', '/sessions/chat.jsonl', '/repo', 'New title']], name: 'New title', repo: 'repo', editing: false, inputs: 0, errors: [],
		});
	});

	test('Escape cancels, restores the title, and does not save', () => {
		rename.begin(session, label);
		input().value = 'Changed';
		key('Escape');
		assert.deepStrictEqual({ text: label.textContent, calls, name: selection.selectedSession?.sessionName, editing: rename.isEditing }, { text: 'repo', calls: [], name: undefined, editing: false });
	});

	test('empty titles cannot be accepted and unchanged titles do not write', () => {
		rename.begin(session, label);
		input().value = '   ';
		key('Enter');
		const emptyStillEditing = rename.isEditing;
		input().value = 'repo';
		key('Enter');
		assert.deepStrictEqual({ emptyStillEditing, editing: rename.isEditing, calls }, { emptyStillEditing: true, editing: false, calls: [] });
	});

	test('clicking away accepts the title, matching Explorer blur behavior', async () => {
		rename.begin(session, label);
		input().value = 'Saved on blur';
		input().blur();
		await timeout(10);
		assert.deepStrictEqual({ name: selection.selectedSession?.sessionName, editing: rename.isEditing }, { name: 'Saved on blur', editing: false });
	});

	test('failed saves report an error without changing the existing session name', async () => {
		fail = true;
		rename.begin(session, label);
		input().value = 'Not saved';
		key('Enter');
		await timeout(0);
		assert.deepStrictEqual({ errors: errors.length, name: selection.selectedSession?.sessionName, text: label.textContent }, { errors: 1, name: undefined, text: 'repo' });
	});

	test('secondary tab menu renames the clicked chat and shares Pin/Unpin with the sidebar', async () => {
		instantiation.stub(IFileService, {});
		instantiation.stub(IPathService, {});
		instantiation.stub(IHoverService, { setupDelayedHover: () => toDisposable(() => {}) });
		const group = store.add(instantiation.createInstance(PiChatConversationGroup, 0, () => {}));
		host.append(group.element);
		group.tabs.render(selection.groups[0]);
		const tab = group.tabs.element.querySelector<HTMLElement>('[role="tab"]')!;
		const show = () => tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		show();
		const initialLabels = menuActions.map(action => action.label);
		await menuActions[1].run();
		const sharedPins = [...instantiation.createInstance(PiChatSessionListService).getPinnedIds()];
		show();
		const pinnedLabels = menuActions.map(action => action.label);
		await menuActions[1].run();
		show();
		await menuActions[0].run();
		const nameInput = tab.querySelector<HTMLInputElement>('input')!;
		nameInput.value = 'From tab menu';
		nameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
		await timeout(0);
		assert.deepStrictEqual({ initialLabels, sharedPins, pinnedLabels, remainingPins: [...instantiation.createInstance(PiChatSessionListService).getPinnedIds()], name: selection.selectedSession?.sessionName }, {
			initialLabels: ['Rename', 'Pin Chat'], sharedPins: ['chat'], pinnedLabels: ['Rename', 'Unpin Chat'], remainingPins: [], name: 'From tab menu',
		});
	});

	test('renamed drafts retain the name in the canonical recovery cache', async () => {
		const draft = { ...session, isDraft: true };
		selection.selectSession(draft);
		rename.begin(draft, label);
		input().value = 'Draft title';
		key('Enter');
		await timeout(0);
		assert.deepStrictEqual({ name: selection.selectedSession?.sessionName, recovered: cache.getDraftSession()?.sessionName }, { name: 'Draft title', recovered: 'Draft title' });
	});
});
