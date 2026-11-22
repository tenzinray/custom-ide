/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { appendPreviewHubLog, capturePreviewHubProcessLogs, protectPreviewHubLogAttempt, prunePreviewHubLogs } from '../../src/vs/platform/previewHub/node/previewHubLogs.ts';

// A pipe consumer, not a daemon: exits as soon as its producer closes stdout/stderr.
const args = process.argv.slice(2);
try {
	if (args[0] === '--prune' && args[1]) {
		const removed = await prunePreviewHubLogs(args[1]);
		console.log(`Pruned ${removed.length} expired Preview Hub log artifacts.`);
	} else {
		const running = args[0] === '--run';
		const [path, attemptId, pidFile] = running ? args.slice(1) : args;
		if (!path || !attemptId) { throw new Error('Usage: logPreviewHub.ts [--run] <log-path> <attempt-id> [pid-file] | --prune <logs-directory>'); }
		const directory = dirname(path);
		await protectPreviewHubLogAttempt(directory, attemptId);
		await appendPreviewHubLog(path, '');
		const prune = () => prunePreviewHubLogs(directory).catch(error => console.error('Preview Hub log cleanup skipped:', error));
		await prune();
		if (running) {
			const command: string[] = JSON.parse(process.env.PREVIEW_HUB_LOG_COMMAND ?? '[]');
			delete process.env.PREVIEW_HUB_LOG_COMMAND;
			if (!pidFile || !Array.isArray(command) || !command.length || !command.every(arg => typeof arg === 'string')) { throw new Error('Missing logged command or watcher PID file'); }
			const child = spawn(command[0], command.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
			const captured = capturePreviewHubProcessLogs(child, path);
			void captured.catch(() => {});
			await once(child, 'spawn');
			await writeFile(pidFile, String(child.pid));
			await captured;
			process.exitCode = child.exitCode ?? 1;
		} else {
			for await (const chunk of process.stdin) { await appendPreviewHubLog(path, chunk); }
		}
		await prune();
	}
} catch (error) {
	console.error('Preview Hub log pipe failed:', error);
	process.exitCode = 1;
}
