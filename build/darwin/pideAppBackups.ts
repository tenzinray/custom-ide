/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** Keep the two newest completed app backups; never follow symlinks or prune unrelated entries. */
export async function prunePideAppBackups(directory: string): Promise<string[]> {
	const backups = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (!entry.isDirectory() || !/^update-[a-zA-Z0-9]{6}$/.test(entry.name)) { continue; }
		const path = join(directory, entry.name);
		const app = await lstat(join(path, 'Pide.app')).catch((error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') { return undefined; }
			throw error;
		});
		if (!app?.isDirectory()) { continue; }
		backups.push({ path, modified: (await lstat(path)).mtimeMs });
	}
	backups.sort((a, b) => b.modified - a.modified || b.path.localeCompare(a.path));
	const removed: string[] = [];
	for (const backup of backups.slice(2)) {
		await rm(backup.path, { recursive: true });
		removed.push(backup.path);
	}
	return removed;
}

if (import.meta.main) {
	const directory = process.argv[2];
	if (!directory || process.argv.length !== 3) {
		console.error('Usage: node build/darwin/pideAppBackups.ts <backup-directory>');
		process.exitCode = 1;
	} else {
		try {
			const removed = await prunePideAppBackups(directory);
			for (const path of removed) { console.log(`Removed old app backup: ${path}`); }
			console.log(`Backup retention complete: kept the newest two completed app backups (or fewer).`);
		} catch (error) {
			console.error('App backup cleanup failed:', error);
			process.exitCode = 1;
		}
	}
}
