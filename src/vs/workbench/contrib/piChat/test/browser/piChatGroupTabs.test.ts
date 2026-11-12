/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { append } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { PiChatGroupTabs } from '../../browser/header/PiChatGroupTabs.js';
import { PiChatGroup } from '../../browser/PiChatSelectionService.js';
import { PiChatTab } from '../../common/pi-chat-tab-types.js';
import { PiChatSessionSummary } from '../../common/pi-chat-types.js';

suite('Pi chat title tabs', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const session = (id: string): PiChatSessionSummary => ({ id, repoName: id, repoPath: `/repos/${id}`, sessionFile: URI.file(`/sessions/${id}.jsonl`), lastMessageAt: '2026-01-01T00:00:00Z', isDraft: true });
	const groups: PiChatGroup[] = [
		{ id: 0, tabs: [session('book'), session('custom-ide')], activeSessionId: 'book' },
		{ id: 1, tabs: [session('other')], activeSessionId: 'other' },
	];

	function createTabs(onNew: () => void, onSelect: (tab: PiChatTab, groupId: number) => void, onClose: (tab: PiChatTab, groupId: number) => void): PiChatGroupTabs {
		const tabs = store.add(new PiChatGroupTabs(onNew, onSelect, onClose, () => { }, upcastPartial<IHoverService>({ setupDelayedHover: () => toDisposable(() => { }) })));
		append(mainWindow.document.body, tabs.element);
		store.add(toDisposable(() => tabs.element.remove()));
		return tabs;
	}

	test('uses title switcher styling with one plus immediately after all chat tabs and no split action', () => {
		let created = 0;
		const tabs = createTabs(() => { created++; }, () => { }, () => { });
		tabs.render(groups[0]);
		tabs.element.querySelector<HTMLButtonElement>('.pi-chat-group-action')!.click();
		assert.deepStrictEqual({
			labels: [...tabs.element.querySelectorAll('.action-label')].map(label => label.textContent),
			selected: tabs.element.querySelector('[aria-selected="true"] .action-label')?.textContent,
			last: tabs.element.querySelector('.actions-container')?.lastElementChild?.className,
			plusCount: tabs.element.querySelectorAll('.codicon-add').length,
			splitCount: tabs.element.querySelectorAll('.codicon-split-horizontal').length,
			duplicateHeaders: tabs.element.querySelectorAll('.pi-chat-group-header').length,
			created,
		}, { labels: ['book', 'custom-ide'], selected: 'book', last: 'pi-chat-add-tab', plusCount: 1, splitCount: 0, duplicateHeaders: 0, created: 1 });
	});

	test('setup tabs have a New Chat label and the compact close glyph', () => {
		const selected: string[] = [];
		const tabs = createTabs(() => { }, tab => selected.push(tab.id), () => { });
		tabs.render({ id: 0, tabs: [{ id: 'setup', isNewChat: true }], activeSessionId: 'setup' });
		tabs.element.querySelector<HTMLElement>('[role="tab"]')!.click();
		assert.deepStrictEqual({ label: tabs.element.querySelector('.action-label')?.textContent, compact: !!tabs.element.querySelector('.pi-chat-tab-close.codicon-close-compact'), selected }, { label: 'New Chat', compact: true, selected: ['setup'] });
	});

	test('selection and closing target the owning split group', () => {
		const selected: string[] = [];
		const closed: string[] = [];
		const tabs = createTabs(() => { }, (session, groupId) => selected.push(`${groupId}:${session.id}`), (session, groupId) => closed.push(`${groupId}:${session.id}`));
		tabs.render(groups[1]);
		const item = tabs.element.querySelector<HTMLElement>('[role="tab"]')!;
		item.click();
		item.querySelector<HTMLButtonElement>('.pi-chat-tab-close')!.click();
		assert.deepStrictEqual({ selected, closed }, { selected: ['1:other'], closed: ['1:other'] });
	});

	test('every active and inactive tab has its own close action without selecting the tab first', () => {
		const selected: string[] = [];
		const closed: string[] = [];
		const tabs = createTabs(() => { }, session => selected.push(session.id), session => closed.push(session.id));
		tabs.render({ ...groups[0], tabs: [...groups[0].tabs, session('third')] });
		const buttons = tabs.element.querySelectorAll<HTMLButtonElement>('.pi-chat-tab-close');
		for (const button of buttons) { button.click(); }
		assert.deepStrictEqual({ labels: [...buttons].map(button => button.getAttribute('aria-label')), closed, selected }, { labels: ['Close book', 'Close custom-ide', 'Close third'], closed: ['book', 'custom-ide', 'third'], selected: [] });
	});

	test('split panes render independent strips containing only their own tabs and plus action', () => {
		const selected: string[] = [];
		const created: number[] = [];
		const first = createTabs(() => created.push(0), (session, id) => selected.push(`${id}:${session.id}`), () => { });
		const second = createTabs(() => created.push(1), (session, id) => selected.push(`${id}:${session.id}`), () => { });
		first.render(groups[0]);
		second.render(groups[1]);
		first.element.querySelector<HTMLButtonElement>('.pi-chat-group-action')!.click();
		second.element.querySelector<HTMLButtonElement>('.pi-chat-group-action')!.click();
		second.element.querySelector<HTMLElement>('[role="tab"]')!.click();
		assert.deepStrictEqual({
			first: [...first.element.querySelectorAll('.action-label')].map(label => label.textContent),
			second: [...second.element.querySelectorAll('.action-label')].map(label => label.textContent),
			selected, created,
		}, { first: ['book', 'custom-ide'], second: ['other'], selected: ['1:other'], created: [0, 1] });
	});

	test('rerender replaces tab controls without duplicating the plus action', () => {
		let created = 0;
		const tabs = createTabs(() => { created++; }, () => { }, () => { });
		tabs.render(groups[1]);
		tabs.render(groups[0]);
		tabs.element.querySelector<HTMLButtonElement>('.pi-chat-group-action')!.click();
		assert.deepStrictEqual({ tabs: tabs.element.querySelectorAll('[role="tab"]').length, plus: tabs.element.querySelectorAll('.codicon-add').length, created }, { tabs: 2, plus: 1, created: 1 });
	});
});
