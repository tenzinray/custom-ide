/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Direction } from '../../../../../base/browser/ui/grid/grid.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { PiChatSelectionService } from '../../browser/PiChatSelectionService.js';
import { PiChatSessionSummary } from '../../common/pi-chat-types.js';

suite('Pi chat groups', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const session = (id: string): PiChatSessionSummary => ({ id, repoName: 'project', repoPath: '/project', sessionFile: URI.file(`/sessions/${id}.jsonl`), lastMessageAt: '2026-01-01T00:00:00Z', isDraft: true });
	const snapshot = (selection: PiChatSelectionService) => ({ selected: selection.selectedSession?.id, active: selection.activeGroupId, groups: selection.groups.map(group => ({ id: group.id, tabs: group.sessions.map(session => session.id), selected: group.activeSessionId })) });

	test('new chats append tabs and selecting an existing chat does not duplicate it', () => {
		const selection = store.add(new PiChatSelectionService());
		selection.selectSession(session('one'));
		selection.selectSession(session('two'));
		selection.selectSession(session('one'));
		assert.deepStrictEqual(snapshot(selection), { selected: 'one', active: 0, groups: [{ id: 0, tabs: ['one', 'two'], selected: 'one' }] });
	});

	test('explicit split preserves the original chat and new tabs target the active group', () => {
		const selection = store.add(new PiChatSelectionService());
		selection.selectSession(session('one'));
		selection.selectSession(session('two'), { direction: Direction.Right });
		selection.selectSession(session('three'));
		assert.deepStrictEqual(snapshot(selection), { selected: 'three', active: 1, groups: [{ id: 0, tabs: ['one'], selected: 'one' }, { id: 1, tabs: ['two', 'three'], selected: 'three' }] });
	});

	test('background session updates preserve the focused chat', () => {
		const selection = store.add(new PiChatSelectionService());
		selection.selectSession(session('one'));
		selection.selectSession(session('two'), { direction: Direction.Right });
		selection.updateSession({ ...session('one'), isDraft: false });
		assert.deepStrictEqual({ snapshot: snapshot(selection), draft: selection.groups[0].sessions[0].isDraft }, { snapshot: { selected: 'two', active: 1, groups: [{ id: 0, tabs: ['one'], selected: 'one' }, { id: 1, tabs: ['two'], selected: 'two' }] }, draft: false });
	});

	test('drag to split moves the tab and leaves its other source tabs intact', () => {
		const selection = store.add(new PiChatSelectionService());
		selection.selectSession(session('one'));
		selection.selectSession(session('two'));
		selection.moveSession(session('two'), 0, { groupId: 0, direction: Direction.Left });
		assert.deepStrictEqual(snapshot(selection), { selected: 'two', active: 1, groups: [{ id: 1, tabs: ['two'], selected: 'two' }, { id: 0, tabs: ['one'], selected: 'one' }] });
	});

	test('left and right splits keep groups in visual order for rightmost global controls', () => {
		const selection = store.add(new PiChatSelectionService());
		selection.selectSession(session('middle'));
		selection.selectSession(session('left'), { groupId: 0, direction: Direction.Left });
		selection.selectSession(session('right'), { groupId: 0, direction: Direction.Right });
		assert.deepStrictEqual(selection.groups.map(group => group.sessions.map(session => session.id)), [['left'], ['middle'], ['right']]);
	});

	test('drag between groups merges tabs and removes an empty source group', () => {
		const selection = store.add(new PiChatSelectionService());
		selection.selectSession(session('one'));
		selection.selectSession(session('two'), { direction: Direction.Right });
		selection.moveSession(session('one'), 0, { groupId: 1 });
		assert.deepStrictEqual(snapshot(selection), { selected: 'one', active: 1, groups: [{ id: 1, tabs: ['two', 'one'], selected: 'one' }] });
	});

	test('closing the final tab in a split focuses the remaining group', () => {
		const selection = store.add(new PiChatSelectionService());
		selection.selectSession(session('one'));
		selection.selectSession(session('two'), { direction: Direction.Right });
		selection.closeSession(1, 'two');
		assert.deepStrictEqual(snapshot(selection), { selected: 'one', active: 0, groups: [{ id: 0, tabs: ['one'], selected: 'one' }] });
	});

	test('closing the final tab leaves an empty group for new chats', () => {
		const selection = store.add(new PiChatSelectionService());
		selection.selectSession(session('one'));
		selection.closeSession(0, 'one');
		assert.deepStrictEqual(snapshot(selection), { selected: undefined, active: 0, groups: [{ id: 0, tabs: [], selected: undefined }] });
	});

	test('a picker targeting a closed group falls back to the active group', () => {
		const selection = store.add(new PiChatSelectionService());
		selection.selectSession(session('one'));
		selection.selectSession(session('two'), { direction: Direction.Right });
		selection.closeSession(1, 'two');
		selection.selectSession(session('three'), { groupId: 1 });
		assert.deepStrictEqual(snapshot(selection), { selected: 'three', active: 0, groups: [{ id: 0, tabs: ['one', 'three'], selected: 'three' }] });
	});
});
