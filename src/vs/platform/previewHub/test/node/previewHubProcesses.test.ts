/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'fs/promises';
import { watch } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from '../../../../base/common/path.js';
import { DeferredPromise, raceTimeout } from '../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { previewHubApps } from '../../common/previewHubApps.js';
import { PreviewHubProcessService } from '../../node/PreviewHubProcessService.js';
import { findPreviewHubProcesses, parsePreviewHubListeners, stopPreviewHubProcesses } from '../../node/previewHubProcesses.js';

suite('PreviewHubProcesses', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('matches exact repo identity, launcher wrappers, and separate Pide watcher/app processes', async () => {
		const table = [
			{ pid: 10, ppid: 1, cmd: 'node /projects/brain-wave/node_modules/vite/bin/vite.js' },
			{ pid: 11, ppid: 1, cmd: 'node /projects/not-brain-wave/node_modules/vite/bin/vite.js' },
			{ pid: 12, ppid: 1, cmd: 'node ./logs/expo-start-logged.js' },
			{ pid: 13, ppid: 1, cmd: 'node /projects/lucent/node_modules/.bin/expo start' },
			{ pid: 14, ppid: 1, cmd: 'node /bin/pnpm run watch' },
			{ pid: 15, ppid: 1, cmd: '/projects/custom-ide/.build/electron/Pide.app/Contents/MacOS/Pide .' },
			{ pid: 16, ppid: 1, cmd: 'node /bin/pnpm run watch' },
			{ pid: 17, ppid: 1, cmd: '/projects/custom-ide/.build/electron/Pide.app/Contents/MacOS/Pide --type=renderer' },
		];
		const cwd = async (pid: number) => pid === 12 ? '/projects/lucent' : pid === 14 ? '/projects/custom-ide' : '/projects/other';
		const results = await Promise.all(previewHubApps.map(async app => [...await findPreviewHubProcesses(app, `/projects/${app.folder}`, table, cwd)].map(([component, entries]) => [component, entries.map(entry => entry.pid)])));
		assert.deepStrictEqual(results, [[['frontend', [10]]], [['frontend', [12, 13]]], [['watcher', [14]], ['app', [15]]]]);
	});

	test('keeps every listening port tied to its PID, deduplicates IPv4/IPv6, and ignores nonlocal addresses', () => {
		const listeners = parsePreviewHubListeners('p101\nf20\nn127.0.0.1:5173\nn[::1]:5173\nn*:9229\np202\nf21\nn[::]:5174\nn192.168.1.2:9999\np303\nf22\nnlocalhost:8081\n');
		assert.deepStrictEqual([...listeners], [[101, ['http://localhost:5173', 'http://localhost:9229']], [202, ['http://localhost:5174']], [303, ['http://localhost:8081']]]);
	});

	test('refuses to terminate the Pide instance hosting Preview Hub', async () => {
		await assert.rejects(() => stopPreviewHubProcesses([{ pid: process.pid, ppid: 1, cmd: 'self' }], []), /Cannot stop the Pide instance/);
	});

	for (const app of previewHubApps.filter(app => app.id !== 'pide')) {
		test(`${app.id}: empty shell overrides preserve npm PATH and allow stop then restart`, async function () {
			if (process.platform !== 'darwin') { this.skip(); }
			this.timeout(20_000);
			const directory = await mkdtemp(join(tmpdir(), 'preview-hub-process-'));
			const root = join(directory, app.folder);
			const service = store.add(new PreviewHubProcessService(directory, async () => ({}), new NullLogService()));
			const readState = async () => (await service.snapshot()).find(state => state.id === app.id)!;
			const startServer = async () => {
				await rm(join(root, 'ready'), { force: true });
				const ready = new DeferredPromise<boolean>();
				const watcher = watch(root, (_event, filename) => {
					if (filename === 'ready') {
						void readFile(join(root, 'ready'), 'utf8').then(value => { if (value === 'ready') { void ready.complete(true); } }, () => {});
					}
				});
				try {
					await service.start(app.id);
					assert.strictEqual(await raceTimeout(ready.p, 10_000), true, 'Server did not signal that it is listening');
					return await readState();
				} finally { watcher.close(); }
			};
			try {
				const script = app.id === 'brain-wave' ? 'node_modules/vite/bin/vite.js' : 'logs/expo-start-logged.js';
				await mkdir(dirname(join(root, script)), { recursive: true });
				await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { [app.command[2]]: `node ${script}` } }));
				await writeFile(join(root, script), 'require("node:http").createServer((req,res)=>res.end("ok")).listen(0,"127.0.0.1",()=>require("node:fs").writeFileSync("ready","ready"));');
				const first = await startServer();
				await service.start(app.id);
				const second = await readState();
				await service.stop(app.id);
				const stopped = await readState();
				const restarted = await startServer();
				assert.deepStrictEqual({ running: first.phase, secondPids: second.processes?.map(entry => entry.pid), hasPort: !!first.processes?.some(entry => entry.urls.length), stopped: stopped.phase, component: stopped.components[0].running, restarted: restarted.phase, restartedPort: !!restarted.processes?.some(entry => entry.urls.length) }, {
					running: 'running', secondPids: first.processes?.map(entry => entry.pid), hasPort: true, stopped: 'stopped', component: false, restarted: 'running', restartedPort: true,
				});
			} finally {
				await service.stop(app.id).catch(() => {});
				service.dispose();
				await rm(directory, { recursive: true, force: true });
			}
		});
	}
});
