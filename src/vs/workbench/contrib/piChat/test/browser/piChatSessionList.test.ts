/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { timeout } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { TestPathService } from '../../../../test/browser/workbenchTestServices.js';
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
			() => actions.push('more'), session => actions.push(`pin:${session.id}`), session => actions.push(`rename:${session.id}`));
		const sections = [...host.querySelectorAll('section')];
		const pinned = sections[0];
		pinned.querySelector<HTMLButtonElement>('.pi-chat-session-pin')!.click();
		pinned.querySelector<HTMLButtonElement>('.pi-chat-session-split')!.click();
		pinned.querySelector<HTMLButtonElement>('.pi-chat-session-button')!.click();
		host.querySelector<HTMLButtonElement>('.pi-chat-load-more')!.click();
		pinned.querySelector<HTMLElement>('.pi-chat-session-name')!.click();
		assert.deepStrictEqual({
			headings: sections.map(section => section.querySelector('h3')!.textContent),
			rows: sections.map(section => [...section.querySelectorAll('.pi-chat-session-name')].map(name => name.textContent)),
			pressed: [...host.querySelectorAll('.pi-chat-session-pin')].map(pin => pin.getAttribute('aria-pressed')),
			chatIcon: host.querySelector('.codicon-comment-discussion'),
			selected: pinned.querySelector('.pi-chat-session-button')!.getAttribute('aria-current'),
			actions,
		}, {
			headings: ['Pinned', 'Recent'], rows: [['pinned'], ['recent']], pressed: ['true', 'false'], chatIcon: null,
			selected: 'page', actions: ['pin:pinned', 'split:pinned', 'select:pinned', 'more', 'rename:pinned'],
		});
	});

	test('clicking the title and pressing F2 start rename without selecting a chat', () => {
		const host = mainWindow.document.createElement('nav');
		const instantiation = store.add(new TestInstantiationService());
		const actions: string[] = [];
		renderPiChatSessionList(host, [{ ...sessions[0], sessionName: 'My renamed chat' }], new Set(), false, undefined, instantiation,
			() => actions.push('select'), () => {}, () => {}, () => {}, (session, label) => actions.push(`${session.id}:${label.textContent}`));
		host.querySelector<HTMLElement>('.pi-chat-session-name')!.click();
		host.querySelector<HTMLElement>('.pi-chat-session-button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
		assert.deepStrictEqual(actions, ['recent:My renamed chat', 'recent:My renamed chat']);
	});

	test('reads native names before long turns, latest names and clears, while keeping the last message timestamp', async () => {
		const instantiation = store.add(new TestInstantiationService());
		const files = store.add(new FileService(new NullLogService()));
		store.add(files.registerProvider('file', store.add(new InMemoryFileSystemProvider())));
		instantiation.stub(IFileService, files);
		instantiation.stub(IPathService, new TestPathService(URI.file('/home/test')));
		instantiation.stub(IStorageService, store.add(new InMemoryStorageService()));
		const service = instantiation.createInstance(PiChatSessionListService);
		const file = URI.file('/home/test/.pi/agent/sessions/repo/2026_chat.jsonl');
		const write = async (entries: object[]) => {
			await files.writeFile(file, VSBuffer.fromString(entries.map(entry => JSON.stringify(entry)).join('\n') + '\n'));
			service.invalidate();
		};
		const entries: object[] = [
			{ type: 'session', id: 'chat', cwd: '/repo', timestamp: '2026-01-01T00:00:00Z' },
			{ type: 'session_info', name: 'Unicode 🐱 title' },
			{ type: 'message', timestamp: '2026-01-02T00:00:00Z', message: { role: 'assistant', content: 'x'.repeat(600_000) } },
		];
		await write(entries);
		const first = await service.findSession('chat');
		entries.push({ type: 'session_info', name: 'Latest title', timestamp: '2026-01-03T00:00:00Z' });
		await write(entries);
		const renamed = await service.findSession('chat');
		entries.push({ type: 'session_info', name: '' });
		await write(entries);
		const cleared = await service.findSession('chat');
		const restored = await instantiation.createInstance(PiChatSessionListService).findSession('chat');
		assert.deepStrictEqual([first, renamed, cleared, restored].map(summary => ({ name: summary?.sessionName, repo: summary?.repoName, timestamp: summary?.lastMessageAt })), [
			{ name: 'Unicode 🐱 title', repo: 'repo', timestamp: '2026-01-02T00:00:00Z' },
			{ name: 'Latest title', repo: 'repo', timestamp: '2026-01-02T00:00:00Z' },
			{ name: '', repo: 'repo', timestamp: '2026-01-02T00:00:00Z' },
			{ name: '', repo: 'repo', timestamp: '2026-01-02T00:00:00Z' },
		]);
	});

	test('persists pins across service instances and removes them on unpin', async () => {
		const instantiation = store.add(new TestInstantiationService());
		instantiation.stub(IFileService, {});
		instantiation.stub(IPathService, {});
		instantiation.stub(IStorageService, store.add(new InMemoryStorageService()));
		const service = instantiation.createInstance(PiChatSessionListService);
		let changes = 0;
		service.onDidChangePins(store.add(new DisposableStore()), () => changes++);
		service.setPinned('pinned', true);
		service.setPinned('pinned', true);
		const restored = instantiation.createInstance(PiChatSessionListService);
		const before = [...restored.getPinnedIds()];
		restored.setPinned('pinned', false);
		await timeout(0);
		assert.deepStrictEqual({ before, after: [...service.getPinnedIds()], notified: changes > 0 }, { before: ['pinned'], after: [], notified: true });
	});
});
