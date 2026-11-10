/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, append } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { PiChatSessionSummary } from '../../common/pi-chat-types.js';
import { PiChatSelectionService } from '../../browser/PiChatSelectionService.js';
import { renderPiChatNewChat } from '../../browser/body/PiChatNewChatBody.js';

suite('Pi chat selected project', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const draft: PiChatSessionSummary = { id: 'draft', repoName: 'book', repoPath: '/repos/book', sessionFile: URI.file('/sessions/draft.jsonl'), lastMessageAt: '2026-01-01T00:00:00Z', isDraft: true };

	test('shows New Chat, the selected repo, and a switch action without a model subtitle', () => {
		const host = append(mainWindow.document.body, $('div'));
		store.add(toDisposable(() => host.remove()));
		let switched = 0;
		store.add(renderPiChatNewChat(host, draft, () => { switched++; }));
		const button = host.querySelector<HTMLButtonElement>('button')!;
		button.click();
		assert.deepStrictEqual({ title: host.querySelector('h1')?.textContent, repo: host.querySelector('strong')?.textContent, path: host.querySelector('small')?.textContent, subtitle: host.querySelector('p'), action: button.textContent, switched }, {
			title: 'New Chat', repo: 'book', path: '/repos/book', subtitle: null, action: 'Switch Project', switched: 1,
		});
	});

	test('clears only selection and broadcasts returning to the repo picker', () => {
		const selection = store.add(new PiChatSelectionService());
		const events: (string | undefined)[] = [];
		store.add(selection.onDidSelectSession(session => events.push(session?.id)));
		selection.selectSession(draft);
		selection.clearSelection();
		assert.deepStrictEqual({ selected: selection.selectedSession, events, draftUnchanged: draft.repoPath }, {
			selected: undefined, events: ['draft', undefined], draftUnchanged: '/repos/book',
		});
	});
});
