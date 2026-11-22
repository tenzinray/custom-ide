/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from '../../../../base/common/path.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { appendPreviewHubLog, capturePreviewHubProcessLogs, previewHubCompletedLogAttempts, previewHubLogMaxBytes, protectPreviewHubLogAttempt, prunePreviewHubLogs } from '../../node/previewHubLogs.js';

suite('PreviewHubLogs', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('bounds large writes and keeps only one rollover segment', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'preview-hub-rotation-'));
		const path = join(directory, 'stream.log');
		try {
			await appendPreviewHubLog(path, Buffer.alloc(previewHubLogMaxBytes, 'a'));
			await appendPreviewHubLog(path, Buffer.alloc(previewHubLogMaxBytes, 'b'));
			await appendPreviewHubLog(path, 'tail');
			const previous = await readFile(`${path}.1`);
			assert.deepStrictEqual({ current: await readFile(path, 'utf8'), previousSize: previous.length, previousStart: previous[0], previousEnd: previous.at(-1), files: (await readdir(directory)).sort() }, {
				current: 'tail', previousSize: previewHubLogMaxBytes, previousStart: 98, previousEnd: 98, files: ['stream.log', 'stream.log.1'],
			});
		} finally { await rm(directory, { recursive: true, force: true }); }
	});

	test('serializes concurrent writers without losing lines', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'preview-hub-writes-'));
		try {
			const lines = Array.from({ length: 50 }, (_value, index) => `${index}\n`);
			await Promise.all(lines.map(line => appendPreviewHubLog(join(directory, 'stream.log'), line)));
			assert.strictEqual(await readFile(join(directory, 'stream.log'), 'utf8'), lines.join(''));
		} finally { await rm(directory, { recursive: true, force: true }); }
	});

	test('retains ten completed attempts, protects active writers, and ignores unrelated files', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'preview-hub-retention-'));
		const id = (index: number) => `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
		try {
			for (let index = 0; index < previewHubCompletedLogAttempts + 2; index++) {
				for (const suffix of ['.log', '.log.1', '-watch.log', '-prelaunch.log', '.ready.json', '.owners']) {
					const path = join(directory, `preview-hub-${id(index)}${suffix}`);
					// A reused PID with the wrong birth time must not protect a dead attempt.
					await writeFile(path, suffix === '.owners' ? JSON.stringify({ pid: process.pid, started: 'wrong birth time' }) : 'old evidence');
					await utimes(path, 1000 + index, 1000 + index);
				}
			}
			const active = join(directory, `preview-hub-${id(99)}-watch.log`);
			await writeFile(active, Buffer.alloc(previewHubLogMaxBytes + 1));
			await protectPreviewHubLogAttempt(directory, id(99));
			await symlink(`preview-hub-${id(0)}-watch.log`, join(directory, 'watch.log'));
			await writeFile(join(directory, 'preview-hub-production-build.log'), 'unrelated build output');
			await writeFile(join(directory, 'notes.txt'), 'unrelated');
			const removed = await prunePreviewHubLogs(directory);
			const files = await readdir(directory);
			assert.deepStrictEqual({ retired: [...new Set(removed.map(path => basename(path).slice(12, 48)))].sort(), completedCount: files.filter(name => name.endsWith('.log') && !name.endsWith('-watch.log') && !name.endsWith('-prelaunch.log') && name !== 'preview-hub-production-build.log').length, activeSize: (await stat(active)).size, danglingAlias: files.includes('watch.log'), unrelated: files.includes('notes.txt') && files.includes('preview-hub-production-build.log'), repeated: await prunePreviewHubLogs(directory) }, {
				retired: [id(0), id(1)], completedCount: previewHubCompletedLogAttempts, activeSize: previewHubLogMaxBytes + 1, danglingAlias: false, unrelated: true, repeated: [],
			});
		} finally { await rm(directory, { recursive: true, force: true }); }
	});

	test('captures noisy child output through bounded pipes and drains before completing', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'preview-hub-capture-'));
		const path = join(directory, 'stream.log');
		const child = spawn(process.execPath, ['-e', `process.stdout.write(Buffer.alloc(${previewHubLogMaxBytes * 3}, 'x')); process.stderr.write('last error\\n');`], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
		try {
			await capturePreviewHubProcessLogs(child, path);
			const sizes = await Promise.all([stat(path), stat(`${path}.1`)]);
			assert.ok(sizes.every(info => info.size <= previewHubLogMaxBytes) && sizes.some(info => info.size > 0));
		} finally {
			if (child.exitCode === null) { child.kill(); }
			await rm(directory, { recursive: true, force: true });
		}
	});
});
