/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IPathService } from '../../../../../platform/path/common/pathService.js';
import { InMemoryStorageService, IStorageService } from '../../../../../platform/storage/common/storage.js';
import { PiChatSessionListService } from '../../browser/PiChatSessionListService.js';
import { renderPiChatSessionList } from '../../browser/sidebar/PiChatSessionList.js';
import { PiChatSessionSummary } from '../../common/pi-chat-types.js';

suite('PiChatSessionList', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const sessions: PiChatSessionSummary[] = ['recent', 'pinned'].map(id => ({
		id, repoName: id, repoPath: `/repo/${id}`, lastMessageAt: '2026-01-01T00:00:00.000Z', sessionFile: URI.file(`/sessions/${id}.jsonl`),
	}));

	test('renders pinned chats separately without left chat icons and preserves row actions', () => {
		const host = mainWindow.document.createElement('nav');
		const instantiation = store.add(new TestInstantiationService());
		const actions: string[] = [];
		renderPiChatSessionList(host, sessions, new Set(['pinned']), true, 'pinned', instantiation,
			session => actions.push(`select:${session.id}`), session => actions.push(`split:${session.id}`),
			() => actions.push('more'), session => actions.push(`pin:${session.id}`));
		const sections = [...host.querySelectorAll('section')];
		const pinned = sections[0];
		pinned.querySelector<HTMLButtonElement>('.pi-chat-session-pin')!.click();
		pinned.querySelector<HTMLButtonElement>('.pi-chat-session-split')!.click();
		pinned.querySelector<HTMLButtonElement>('.pi-chat-session-button')!.click();
		host.querySelector<HTMLButtonElement>('.pi-chat-load-more')!.click();
		assert.deepStrictEqual({
			headings: sections.map(section => section.querySelector('h3')!.textContent),
			rows: sections.map(section => [...section.querySelectorAll('.pi-chat-session-name')].map(name => name.textContent)),
			pressed: [...host.querySelectorAll('.pi-chat-session-pin')].map(pin => pin.getAttribute('aria-pressed')),
			chatIcon: host.querySelector('.codicon-comment-discussion'),
			selected: pinned.querySelector('.pi-chat-session-button')!.getAttribute('aria-current'),
			actions,
		}, {
			headings: ['Pinned', 'Recent'], rows: [['pinned'], ['recent']], pressed: ['true', 'false'], chatIcon: null,
			selected: 'page', actions: ['pin:pinned', 'split:pinned', 'select:pinned', 'more'],
		});
	});

	test('persists pins across service instances and removes them on unpin', () => {
		const instantiation = store.add(new TestInstantiationService());
		instantiation.stub(IFileService, {});
		instantiation.stub(IPathService, {});
		instantiation.stub(IStorageService, store.add(new InMemoryStorageService()));
		const service = instantiation.createInstance(PiChatSessionListService);
		service.setPinned('pinned', true);
		service.setPinned('pinned', true);
		const restored = instantiation.createInstance(PiChatSessionListService);
		const before = [...restored.getPinnedIds()];
		restored.setPinned('pinned', false);
		assert.deepStrictEqual({ before, after: [...service.getPinnedIds()] }, { before: ['pinned'], after: [] });
	});
});
