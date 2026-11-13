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
export async function openPreviewHubPideWindow(root: string, command: string, env: IProcessEnvironment): Promise<void> {
	const args = getPreviewHubPideWindowArgs(command);
	const log = join(root, previewHubLauncherLogPath);
	await mkdir(join(root, 'logs'), { recursive: true });
	await appendFile(log, `[Preview Hub] ${new Date().toISOString()} Opening another dev window\n`);
	try {
		const { stdout, stderr } = await exec('/bin/bash', args, { cwd: root, env: { ...env, VSCODE_SKIP_PRELAUNCH: '1' }, timeout: 15_000, maxBuffer: 1024 * 1024 });
		if (stdout || stderr) { await appendFile(log, stdout + stderr); }
	} catch (error) {
		await appendFile(log, `[Preview Hub] New window failed: ${error instanceof Error ? error.message : String(error)}\n`);
		throw error;
	}
}
