/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { timeout } from '../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { previewHubApps } from '../../common/previewHubApps.js';
import { PreviewHubProcessService } from '../../node/PreviewHubProcessService.js';
import { findPreviewHubProcesses, stopPreviewHubProcesses } from '../../node/previewHubProcesses.js';

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

	test('refuses to terminate the Pide instance hosting Preview Hub', async () => {
		await assert.rejects(() => stopPreviewHubProcesses([{ pid: process.pid, ppid: 1, cmd: 'self' }], []), /Cannot stop the Pide instance/);
	});

	test('starts, detects, and stops only its synthetic app, without duplicating an already running app', async function () {
		if (process.platform !== 'darwin') { this.skip(); }
		this.timeout(20_000);
		const directory = await mkdtemp(join(tmpdir(), 'preview-hub-process-'));
		const root = join(directory, 'brain-wave');
		const service = store.add(new PreviewHubProcessService(directory, async () => ({ ...process.env }), new NullLogService()));
		try {
			await mkdir(join(root, 'node_modules/vite/bin'), { recursive: true });
			await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'node node_modules/vite/bin/vite.js' } }));
			await writeFile(join(root, 'node_modules/vite/bin/vite.js'), 'require("node:http").createServer((req,res)=>res.end("ok")).listen(0,"127.0.0.1");');
			await service.start('brain-wave');
			let state = (await service.snapshot())[0];
			for (let attempt = 0; attempt < 30 && !state.previewUrl; attempt++) { await timeout(100); state = (await service.snapshot())[0]; }
			const first = state;
			await service.start('brain-wave');
			const second = (await service.snapshot())[0];
			await service.stop('brain-wave');
			const stopped = (await service.snapshot())[0];
			assert.deepStrictEqual({ running: first.phase, sameUrl: first.previewUrl === second.previewUrl, hasUrl: !!first.previewUrl, stopped: stopped.phase, component: stopped.components[0].running }, {
				running: 'running', sameUrl: true, hasUrl: true, stopped: 'stopped', component: false,
			});
		} finally {
			await service.stop('brain-wave').catch(() => {});
			service.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	});
});
