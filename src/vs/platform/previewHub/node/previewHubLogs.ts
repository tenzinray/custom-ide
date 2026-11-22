/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure Node: shared by the production process owner and the checkout's log-pipe command.
import { execFile, type ChildProcess } from 'child_process';
import { appendFile, lstat, mkdir, open, readdir, readFile, readlink, rename, rm } from 'fs/promises';
// Also executed directly from source by the checkout log pipe, without compiled VS Code path modules.
// eslint-disable-next-line local/code-import-patterns
import { dirname, join, resolve } from 'path';
import { promisify } from 'util';

export const previewHubLogMaxBytes = 5 * 1024 * 1024;
export const previewHubCompletedLogAttempts = 10;
const writes = new Map<string, Promise<void>>();
const exec = promisify(execFile);
const artifact = /^preview-hub-(?<id>[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|manual-(?:\d+-)?\d+)(?:-(?:watch|prelaunch))?(?:\.log(?:\.1)?|\.ready\.json|\.owners)$/i;

/** A small, non-rotating readiness record keeps functional startup evidence out of rotating text. */
export function previewHubReadyFilePath(logPath: string): string {
	return logPath.replace(/\.log$/, '.ready.json');
}

/** Serialize writers per file; retain at most the current segment and one rollover segment. */
export function appendPreviewHubLog(path: string, content: string | Uint8Array): Promise<void> {
	const key = resolve(path);
	const operation = (writes.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
		await mkdir(dirname(key), { recursive: true });
		const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
		if (!bytes.length) { await appendFile(key, bytes); return; }
		let size = await lstat(key).then(stat => stat.size, error => { if (error.code === 'ENOENT') { return 0; } throw error; });
		for (let offset = 0; offset < bytes.length;) {
			if (size >= previewHubLogMaxBytes) {
				await capCompletedLog(key);
				await rm(`${key}.1`, { force: true });
				await rename(key, `${key}.1`).catch(error => { if (error.code !== 'ENOENT') { throw error; } });
				size = 0;
			}
			const end = Math.min(bytes.length, offset + previewHubLogMaxBytes - size);
			await appendFile(key, bytes.subarray(offset, end));
			size += end - offset;
			offset = end;
		}
	});
	writes.set(key, operation);
	const forget = () => { if (writes.get(key) === operation) { writes.delete(key); } };
	void operation.then(forget, forget);
	return operation;
}

/** Pause each pipe while writing so a noisy child cannot create an unbounded memory queue. */
export function capturePreviewHubProcessLogs(child: ChildProcess, path: string): Promise<void> {
	let last = Promise.resolve();
	let failure: Error | undefined;
	for (const stream of [child.stdout, child.stderr]) {
		stream?.on('data', (chunk: Buffer) => {
			stream.pause();
			last = appendPreviewHubLog(path, chunk).then(() => { stream.resume(); }, error => { failure = error; stream.resume(); });
		});
		stream?.on('error', error => { failure = error; });
	}
	return new Promise<void>((complete, reject) => child.once('close', () => {
		void last.then(() => { if (failure) { reject(failure); } else { complete(); } }, reject);
	}));
}

async function processBirths(): Promise<Map<number, string>> {
	const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,lstart='], { env: { ...process.env, LC_ALL: 'C' }, timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
	const result = new Map<number, string>();
	for (const line of stdout.split('\n')) {
		const match = /^\s*(?<pid>\d+)\s+(?<started>.+?)\s*$/.exec(line)?.groups;
		if (match) { result.set(Number(match.pid), match.started); }
	}
	return result;
}

/** Protect a whole attempt while any actual writer/launcher remains alive; PID reuse does not count. */
export async function protectPreviewHubLogAttempt(directory: string, attemptId: string, pid = process.pid): Promise<void> {
	if (!artifact.test(`preview-hub-${attemptId}.owners`)) { throw new Error('Invalid Preview Hub log attempt ID'); }
	const started = (await processBirths()).get(pid);
	if (!started) { return; }
	await mkdir(directory, { recursive: true });
	await appendFile(join(directory, `preview-hub-${attemptId}.owners`), `${JSON.stringify({ pid, started })}\n`);
}

/** Run on lifecycle events only: preserve active attempts, retain ten completed groups, ignore unrelated files. */
export async function prunePreviewHubLogs(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const groups = new Map<string, { files: string[]; modified: number; active: boolean }>();
	const births = await processBirths(); // If process discovery fails, do not risk pruning active evidence.
	for (const entry of entries) {
		const id = artifact.exec(entry.name)?.groups?.id;
		if (!id || !entry.isFile()) { continue; }
		const path = join(directory, entry.name);
		const group = groups.get(id) ?? { files: [], modified: 0, active: false };
		const stat = await lstat(path).catch(error => { if (error.code === 'ENOENT') { return undefined; } throw error; });
		if (!stat) { continue; }
		group.files.push(path);
		group.modified = Math.max(group.modified, stat.mtimeMs);
		if (entry.name.endsWith('.owners')) {
			for (const line of (await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') { return ''; } throw error; })).split('\n')) {
				try {
					const owner = JSON.parse(line) as { pid: number; started: string };
					if (typeof owner.started === 'string' && births.get(owner.pid) === owner.started) { group.active = true; }
				} catch { /* Ignore an incomplete ownership line while another process appends it. */ }
			}
		}
		groups.set(id, group);
	}
	// Preserve an older running watcher's logs too, when upgrading from pre-ownership instrumentation.
	const watcherPid = Number(await readFile(join(directory, 'watch.pid'), 'utf8').catch(() => ''));
	if (births.has(watcherPid)) {
		const target = await readlink(join(directory, 'watch.log')).catch(() => '');
		const id = artifact.exec(target)?.groups?.id;
		const group = id ? groups.get(id) : undefined;
		if (group && !group.files.some(path => path.endsWith('.owners'))) { group.active = true; }
	}
	const completed = [...groups.values()].filter(group => !group.active).sort((a, b) => b.modified - a.modified || a.files[0].localeCompare(b.files[0]));
	const removed: string[] = [];
	for (const group of completed.slice(previewHubCompletedLogAttempts)) {
		for (const path of group.files) { await rm(path, { force: true }); removed.push(path); }
	}
	for (const alias of ['watch.log', 'prelaunch.log']) {
		const path = join(directory, alias);
		const target = await readlink(path).catch(() => undefined);
		if (target && removed.includes(resolve(directory, target))) { await rm(path, { force: true }); }
	}
	for (const group of completed.slice(0, previewHubCompletedLogAttempts)) {
		for (const path of group.files.filter(path => /\.log(?:\.1)?$/.test(path))) { await capCompletedLog(path); }
	}
	return removed;
}

async function capCompletedLog(path: string): Promise<void> {
	const file = await open(path, 'r+').catch(error => { if (error.code === 'ENOENT') { return undefined; } throw error; });
	if (!file) { return; }
	try {
		const { size, atime, mtime } = await file.stat();
		if (size <= previewHubLogMaxBytes) { return; }
		const tail = Buffer.alloc(previewHubLogMaxBytes);
		let read = 0;
		while (read < tail.length) {
			const { bytesRead } = await file.read(tail, read, tail.length - read, size - tail.length + read);
			if (!bytesRead) { break; }
			read += bytesRead;
		}
		await file.truncate(0);
		await file.writeFile(tail.subarray(0, read));
		await file.utimes(atime, mtime);
	} finally { await file.close(); }
}
