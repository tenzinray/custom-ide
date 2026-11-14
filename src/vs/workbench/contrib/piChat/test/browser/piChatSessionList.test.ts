/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { TestPathService } from '../../../../test/browser/workbenchTestServices.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IPathService } from '../../../../../platform/path/common/pathService.js';
import { InMemoryStorageService, IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
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

	function setupSessions(log = new NullLogService()) {
		const instantiation = store.add(new TestInstantiationService());
		const provider = store.add(new class extends InMemoryFileSystemProvider {
			bytesRead = 0;
			unbufferedReads = 0;
			override async read(...args: Parameters<InMemoryFileSystemProvider['read']>): Promise<number> {
				const count = await super.read(...args); this.bytesRead += count; return count;
			}
			override async readFile(resource: URI): Promise<Uint8Array> { this.unbufferedReads++; return super.readFile(resource); }
		}());
		const files = store.add(new class extends FileService {
			readonly requests: { position: number; length: number }[] = [];
			backgroundGate: DeferredPromise<void> | undefined;
			readonly backgroundStarted = new DeferredPromise<void>();
			override async readFileStream(...args: Parameters<FileService['readFileStream']>): ReturnType<FileService['readFileStream']> {
				this.requests.push({ position: args[1]?.position ?? 0, length: args[1]?.length ?? 0 });
				if ((args[1]?.length ?? 0) > 65_536) { void this.backgroundStarted.complete(); await this.backgroundGate?.p; }
				return super.readFileStream(...args);
			}
		}(new NullLogService()));
		store.add(files.registerProvider('file', provider));
		const storage = store.add(new InMemoryStorageService());
		instantiation.stub(IFileService, files);
		instantiation.stub(IPathService, new TestPathService(URI.file('/home/test')));
		instantiation.stub(IStorageService, storage);
		instantiation.stub(IEnvironmentService, { isBuilt: false });
		instantiation.stub(ILogService, log);
		return { instantiation, files, provider, storage, service: instantiation.createInstance(PiChatSessionListService) };
	}

	test('returns bounded cold results without waiting for indexing; shares the scan and persists unnamed metadata across windows', async () => {
		const { instantiation, files, provider, storage, service } = setupSessions();
		const file = URI.file('/home/test/.pi/agent/sessions/repo/2026_chat.jsonl');
		const entries = [
			{ type: 'session', id: 'chat', cwd: '/repo', timestamp: '2026-01-01T00:00:00Z' },
			{ type: 'message', timestamp: '2026-01-02T00:00:00Z', message: { role: 'assistant', content: 'x'.repeat(2_000_000) } },
			{ type: 'message', timestamp: '2026-01-03T00:00:00Z', message: { role: 'user' } },
		];
		await files.writeFile(file, VSBuffer.fromString(entries.map(entry => JSON.stringify(entry)).join('\n') + '\n'));
		files.backgroundGate = new DeferredPromise<void>();
		const hydrated = new DeferredPromise<void>();
		service.onDidChangeSummaries(store.add(new DisposableStore()), () => { void hydrated.complete(); });
		const [first, concurrent] = await Promise.all([service.findSession('chat'), instantiation.createInstance(PiChatSessionListService).findSession('chat')]);
		const cold = { reads: files.requests.length, bytes: provider.bytesRead, unbuffered: provider.unbufferedReads, timestamp: first?.lastMessageAt, shared: first?.id === concurrent?.id };
		await files.backgroundStarted.p;
		void files.backgroundGate.complete();
		await hydrated.p;
		// A separate storage service simulates a fresh renderer, not the process-local reader singleton.
		const nextStorage = store.add(new InMemoryStorageService());
		for (const key of storage.keys(StorageScope.PROFILE, StorageTarget.MACHINE)) { nextStorage.store(key, storage.get(key, StorageScope.PROFILE), StorageScope.PROFILE, StorageTarget.MACHINE); }
		instantiation.stub(IStorageService, nextStorage);
		const before = files.requests.length;
		const restored = await instantiation.createInstance(PiChatSessionListService).findSession('chat');
		assert.deepStrictEqual({ cold, fullScans: files.requests.filter(read => read.length > 65_536).length, restored: { id: restored?.id, name: restored?.sessionName, timestamp: restored?.lastMessageAt }, warmReads: files.requests.length - before }, {
			cold: { reads: 2, bytes: 81_920, unbuffered: 0, timestamp: '2026-01-03T00:00:00Z', shared: true }, fullScans: 1,
			restored: { id: 'chat', name: undefined, timestamp: '2026-01-03T00:00:00Z' }, warmReads: 0,
		});
	});

	test('recovers native names before long turns in the background, then reads only appended metadata for renames and clears', async () => {
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
		const hydrated = new DeferredPromise<void>();
		service.onDidChangeSummaries(store.add(new DisposableStore()), () => { void hydrated.complete(); });
		await service.findSession('chat');
		await hydrated.p;
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

	test('a missing pin skips native UUID transcripts; legacy filenames need only bounded identity reads', async () => {
		const { files, service } = setupSessions();
		for (const id of ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']) {
			await files.writeFile(URI.file(`/home/test/.pi/agent/sessions/repo/2026_${id}.jsonl`), VSBuffer.fromString(JSON.stringify({ type: 'session', id, cwd: '/repo', timestamp: '2026-01-01' }) + '\n'));
		}
		const legacy = URI.file('/home/test/.pi/agent/sessions/repo/legacy.jsonl');
		await files.writeFile(legacy, VSBuffer.fromString(JSON.stringify({ type: 'session', id: 'legacy', cwd: '/repo', timestamp: '2026-01-01' }) + '\n'));
		const missing = await service.findSession('deleted');
		const missingReads = [...files.requests];
		const found = await service.findSession('legacy');
		assert.deepStrictEqual({ missing, missingReads: missingReads.length, bounded: missingReads.every(read => read.length <= 16_384), legacy: found?.id }, { missing: undefined, missingReads: 1, bounded: true, legacy: 'legacy' });
	});

	test('background indexing recovers middle-of-file names, and large append indexing starts at the cached boundary', async () => {
		const diagnostics: string[] = [];
		const log = new class extends NullLogService { override info(...args: Parameters<NullLogService['info']>): void { diagnostics.push(String(args[1])); } }();
		const { files, service } = setupSessions(log);
		const file = URI.file('/home/test/.pi/agent/sessions/repo/2026_chat.jsonl');
		let text = [
			{ type: 'session', id: 'chat', cwd: '/repo', timestamp: '2026-01-01' },
			{ type: 'message', message: { role: 'assistant', content: 'x'.repeat(100_000) }, timestamp: '2026-01-02' },
			{ type: 'session_info', name: 'Middle 🐱' },
			{ type: 'message', message: { role: 'assistant', content: 'x'.repeat(100_000) }, timestamp: '2026-01-03' },
		].map(entry => JSON.stringify(entry)).join('\n') + '\n';
		const changes: DeferredPromise<void>[] = [];
		service.onDidChangeSummaries(store.add(new DisposableStore()), () => { void changes.at(-1)?.complete(); });
		const writeAndIndex = async () => {
			await files.writeFile(file, VSBuffer.fromString(text)); service.invalidate();
			const change = new DeferredPromise<void>(); changes.push(change);
			const provisional = await service.findSession('chat');
			await change.p;
			return { provisional, indexed: await service.findSession('chat') };
		};
		const first = await writeAndIndex();
		const boundary = VSBuffer.fromString(text).byteLength;
		text += JSON.stringify({ type: 'session_info', name: 'After append' }) + '\n' + JSON.stringify({ type: 'message', message: { role: 'assistant', content: 'x'.repeat(100_000) }, timestamp: '2026-01-04' }) + '\n';
		const appended = await writeAndIndex();
		const scans = files.requests.filter(read => read.length > 65_536);
		assert.deepStrictEqual({ first: first.indexed?.sessionName, initiallyUnnamed: first.provisional?.sessionName, appended: appended.indexed?.sessionName, timestamp: appended.indexed?.lastMessageAt, scanOffsets: scans.map(read => read.position), logsProvisional: diagnostics.some(line => line.includes('"source":"metadata.probe.publish"') && line.includes('"name":null')), logsRecovered: diagnostics.some(line => line.includes('"source":"metadata.background.publish"') && line.includes('"name":"Middle 🐱"')), leaksTranscript: diagnostics.some(line => line.includes('x'.repeat(1000))) }, {
			first: 'Middle 🐱', initiallyUnnamed: undefined, appended: 'After append', timestamp: '2026-01-04', scanOffsets: [0, boundary], logsProvisional: true, logsRecovered: true, leaksTranscript: false,
		});
	});

	test('an append during background indexing cannot publish stale metadata or strand the newer scan', async () => {
		const { files, service } = setupSessions();
		const file = URI.file('/home/test/.pi/agent/sessions/repo/2026_chat.jsonl');
		let text = JSON.stringify({ type: 'session', id: 'chat', cwd: '/repo', timestamp: '2026-01-01' }) + '\n' +
			JSON.stringify({ type: 'message', message: { role: 'assistant', content: 'x'.repeat(100_000) }, timestamp: '2026-01-02' }) + '\n';
		await files.writeFile(file, VSBuffer.fromString(text));
		files.backgroundGate = new DeferredPromise<void>();
		await service.findSession('chat');
		await files.backgroundStarted.p;
		text += JSON.stringify({ type: 'session_info', name: 'Newest' }) + '\n';
		await files.writeFile(file, VSBuffer.fromString(text)); service.invalidate();
		await service.findSession('chat');
		const hydrated = new DeferredPromise<void>();
		service.onDidChangeSummaries(store.add(new DisposableStore()), () => { void hydrated.complete(); });
		void files.backgroundGate.complete();
		await hydrated.p;
		const current = await service.findSession('chat');
		assert.deepStrictEqual({ name: current?.sessionName, timestamp: current?.lastMessageAt }, { name: 'Newest', timestamp: '2026-01-02' });
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
