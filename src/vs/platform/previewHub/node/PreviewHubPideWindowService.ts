/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { appendFile, mkdir } from 'fs/promises';
import { promisify } from 'util';
import { IProcessEnvironment } from '../../../base/common/platform.js';
import { join } from '../../../base/common/path.js';
import { localize } from '../../../nls.js';
import { previewHubLauncherLogPath } from '../common/previewHub.js';

const exec = promisify(execFile);

/** Forward only profile identity to the existing dev singleton, not its debug ports or workspace. */
export function getPreviewHubPideWindowArgs(command: string): string[] {
	const args = ['scripts/code.sh', '--new-window'];
	const pattern = /(?:^|\s)--(?<name>user-data-dir|extensions-dir|shared-data-dir)(?:=|\s+)(?:"(?<doubleQuoted>[^"]+)"|'(?<singleQuoted>[^']+)'|(?<unquoted>.*?))(?=\s--[\w-]+(?:=|\s|$)|$)/g;
	for (const match of command.matchAll(pattern)) {
		const groups = match.groups!;
		const value = groups.doubleQuoted ?? groups.singleQuoted ?? groups.unquoted;
		args.push(`--${groups.name}=${value}`);
	}
	if (!args.some(arg => arg.startsWith('--user-data-dir='))) {
		throw new Error(localize('previewHub.noDevProfile', "Could not identify the running dev app's profile. Open its launcher log before retrying."));
	}
	return args;
}

/** code.sh forwards --new-window to the running dev app without creating or resyncing a profile. */
export async function openPreviewHubPideWindow(root: string, command: string, env: IProcessEnvironment, pid: number): Promise<void> {
	const args = getPreviewHubPideWindowArgs(command);
	const log = join(root, previewHubLauncherLogPath);
	await mkdir(join(root, 'logs'), { recursive: true });
	await appendFile(log, `[Preview Hub] ${new Date().toISOString()} Opening another dev window\n`);
	try {
		const port = /(?:^|\s)--remote-debugging-port(?:=|\s+)(?<port>\d+)(?:\s|$)/.exec(command)?.groups?.port;
		if (!port) { throw new Error(localize('previewHub.noDevCdp', "The running dev app has no CDP port; its window cannot be verified. Check the launcher log.")); }
		const verifyArgs = ['scripts/code-oss-launcher/waitForWorkbench.ts', String(pid), port];
		const options = { cwd: root, env: { ...env, VSCODE_SKIP_PRELAUNCH: '1' }, maxBuffer: 1024 * 1024 };
		const before = await exec('node', [...verifyArgs, '--list'], { ...options, timeout: 5000 });
		await appendFile(log, `[Preview Hub] ${new Date().toISOString()} Existing windows for PID ${pid}, CDP ${port}: ${before.stdout.trim()}\n`);
		const { stdout, stderr } = await exec('/bin/bash', args, { ...options, timeout: 15_000 });
		if (stdout || stderr) { await appendFile(log, stdout + stderr); }
		const verified = await exec('node', [...verifyArgs, '30000', before.stdout.trim()], { ...options, timeout: 35_000 });
		await appendFile(log, `[Preview Hub] ${new Date().toISOString()} New window verification: ${verified.stdout.trim()}\n${verified.stderr}`);
	} catch (error) {
		const output = error as Error & { stdout?: string; stderr?: string };
		await appendFile(log, `[Preview Hub] ${new Date().toISOString()} New window failed: ${output.message ?? String(error)}\n${output.stdout ?? ''}${output.stderr ?? ''}`);
		throw error;
	}
}
