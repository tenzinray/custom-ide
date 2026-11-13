/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { promisify } from 'util';
import { ProcessItem } from '../../../base/common/processes.js';
import { escapeRegExpCharacters } from '../../../base/common/strings.js';
import { previewHubApps } from '../common/previewHubApps.js';

const exec = promisify(execFile);
export type PreviewHubProcess = Pick<ProcessItem, 'pid' | 'ppid' | 'cmd'>;

export async function readPreviewHubProcesses(): Promise<PreviewHubProcess[]> {
	const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=,command='], { maxBuffer: 8 * 1024 * 1024, timeout: 5000 });
	return stdout.split('\n').flatMap(line => {
		const match = /^\s*(?<pid>\d+)\s+(?<ppid>\d+)\s+(?<cmd>.+)$/.exec(line)?.groups;
		return match ? [{ pid: Number(match.pid), ppid: Number(match.ppid), cmd: match.cmd }] : [];
	});
}

async function readCwd(pid: number): Promise<string | undefined> {
	try {
		const { stdout } = await exec('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 3000 });
		return stdout.split('\n').find(line => line.startsWith('n'))?.slice(1);
	} catch { return undefined; }
}

/** Match the actual executable plus repository identity, never just a popular port or an npm process. */
export async function findPreviewHubProcesses(app: typeof previewHubApps[number], root: string, table: readonly PreviewHubProcess[], cwd = readCwd): Promise<Map<string, PreviewHubProcess[]>> {
	const result = new Map<string, PreviewHubProcess[]>();
	for (const component of app.components) {
		const absolute = new RegExp(`${escapeRegExpCharacters(root)}/${component.match}(?:\\s|$)`);
		const relative = new RegExp(`(?:^|\\s)(?:[^\\s]*/)?${component.match}(?:\\s|$)`);
		const candidates = table.filter(entry => !entry.cmd.includes(' --type=') && (absolute.test(entry.cmd) || relative.test(entry.cmd)));
		const matches = await Promise.all(candidates.map(async entry => absolute.test(entry.cmd) || await cwd(entry.pid) === root ? entry : undefined));
		result.set(component.id, matches.filter(entry => entry !== undefined));
	}
	return result;
}

/** Child-first cleanup, with a fresh command comparison before each signal to avoid reused PIDs. */
export async function stopPreviewHubProcesses(roots: readonly PreviewHubProcess[], table: readonly PreviewHubProcess[]): Promise<void> {
	const targets = new Map<number, PreviewHubProcess>();
	const collect = (entry: PreviewHubProcess) => {
		if (targets.has(entry.pid)) { return; }
		targets.set(entry.pid, entry);
		for (const child of table.filter(child => child.ppid === entry.pid)) { collect(child); }
	};
	for (const root of roots) { collect(root); }
	if (targets.has(process.pid)) { throw new Error('Cannot stop the Pide instance hosting Preview Hub. Use Preview Hub in another Pide instance.'); }
	for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
		const current = await readPreviewHubProcesses();
		for (const target of [...targets.values()].reverse()) {
			if (!current.some(entry => entry.pid === target.pid && entry.cmd === target.cmd)) { continue; }
			try { process.kill(target.pid, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') { throw error; } }
		}
		if (signal === 'SIGTERM') { await new Promise(resolve => setTimeout(resolve, 1500)); }
	}
}

/** A pre-existing watcher may write to a different log than our standard launcher. */
export async function getPreviewHubProcessLog(entry: PreviewHubProcess | undefined): Promise<string | undefined> {
	if (!entry) { return undefined; }
	try {
		const { stdout } = await exec('/usr/sbin/lsof', ['-a', '-p', String(entry.pid), '-d', '1', '-Fn'], { timeout: 3000 });
		const path = stdout.split('\n').find(line => line.startsWith('n/'))?.slice(1);
		return path?.endsWith('.log') ? path : undefined;
	} catch { return undefined; }
}

export async function getPreviewHubUrl(processes: readonly PreviewHubProcess[]): Promise<string | undefined> {
	if (!processes.length) { return undefined; }
	try {
		const { stdout } = await exec('/usr/sbin/lsof', ['-a', '-p', processes.map(entry => entry.pid).join(','), '-iTCP', '-sTCP:LISTEN', '-Fn'], { timeout: 3000 });
		const port = /^n(?:127\.0\.0\.1|localhost|\*|\[::1\]):(?<port>\d+)$/m.exec(stdout)?.groups?.port;
		return port ? `http://localhost:${port}` : undefined;
	} catch { return undefined; }
}
