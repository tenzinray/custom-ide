/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { suite, test } from 'node:test';
import { prunePideAppBackups } from '../../darwin/pideAppBackups.ts';

suite('Pide app backup retention', () => {
	test('keeps the newest two app backups, ignores unrelated entries, and is idempotent', async () => {
		const root = await mkdtemp(join(tmpdir(), 'pide-app-backups-'));
		try {
			const backups = join(root, 'backups');
			for (const [index, name] of ['update-aaaaaa', 'update-bbbbbb', 'update-cccccc', 'update-dddddd'].entries()) {
				const backup = join(backups, name);
				await mkdir(join(backup, 'Pide.app'), { recursive: true });
				await utimes(backup, 1000 + index, 1000 + index);
			}
			await mkdir(join(backups, 'update-empty0'));
			await mkdir(join(backups, 'unrelated/Pide.app'), { recursive: true });
			await writeFile(join(backups, 'notes.txt'), 'Leave me alone.');
			await symlink(join(backups, 'unrelated'), join(backups, 'update-symlnk'), 'dir');
			await mkdir(join(backups, 'update-appsym'));
			await symlink(join(backups, 'unrelated/Pide.app'), join(backups, 'update-appsym/Pide.app'), 'dir');

			const removed = await prunePideAppBackups(backups);
			const second = await prunePideAppBackups(backups);
			assert.deepStrictEqual({ removed: removed.map(path => basename(path)), second, remaining: (await readdir(backups)).sort() }, {
				removed: ['update-bbbbbb', 'update-aaaaaa'], second: [],
				remaining: ['notes.txt', 'unrelated', 'update-appsym', 'update-cccccc', 'update-dddddd', 'update-empty0', 'update-symlnk'],
			});
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	test('does not remove the only available backup', async () => {
		const root = await mkdtemp(join(tmpdir(), 'pide-app-backups-'));
		try {
			await mkdir(join(root, 'update-single/Pide.app'), { recursive: true });
			assert.deepStrictEqual({ removed: await prunePideAppBackups(root), remaining: await readdir(root) }, { removed: [], remaining: ['update-single'] });
		} finally { await rm(root, { recursive: true, force: true }); }
	});
});
