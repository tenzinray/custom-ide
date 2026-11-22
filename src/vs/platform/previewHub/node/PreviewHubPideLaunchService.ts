/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { readFile } from 'fs/promises';
import { promisify } from 'util';
import { IProcessEnvironment } from '../../../base/common/platform.js';
import { localize } from '../../../nls.js';
import { PreviewHubPideLaunch } from '../common/preview-hub-types.js';
import { previewHubReadyFilePath } from './previewHubLogs.js';

const exec = promisify(execFile);

/** Resolve the permanent profile through the launcher that owns its identity and overrides. */
export async function getPreviewHubPideProfile(root: string, env: IProcessEnvironment): Promise<string> {
	const { stdout } = await exec('node', ['scripts/code-oss-launcher/lib/persistentProfile.ts'], { cwd: root, env, timeout: 10_000, maxBuffer: 64 * 1024 });
	const profile = JSON.parse(stdout) as { userDataDir?: string };
	if (typeof profile?.userDataDir !== 'string' || !profile.userDataDir) {
		throw new Error(localize('previewHub.profileIdentity', "The launcher did not report its permanent profile. Check the launcher log."));
	}
	return profile.userDataDir;
}

/** Only this attempt's profile, PID and rendered-workbench acknowledgement can complete startup. */
export async function readPreviewHubPideLaunch(path: string, attemptId: string, userDataDir: string): Promise<PreviewHubPideLaunch | undefined> {
	const content = await readFile(previewHubReadyFilePath(path), 'utf8').catch(error => {
		if (error.code === 'ENOENT') { return readFile(path, 'utf8'); }
		throw error;
	});
	for (const line of content.split('\n')) {
		if (!line.startsWith('{')) { continue; }
		let record: Partial<PreviewHubPideLaunch>;
		try { record = JSON.parse(line) as Partial<PreviewHubPideLaunch>; } catch { continue; }
		if (record?.attemptId !== attemptId) { continue; }
		if (record.userDataDir !== userDataDir) {
			throw new Error(localize('previewHub.wrongProfile', "The dev launcher reported a different profile. Its app is not being counted as this launch."));
		}
		if (typeof record.pid === 'number' && Number.isInteger(record.pid) && record.pid > 0
			&& typeof record.cdpPort === 'number' && record.cdpPort > 0 && record.cdpPort <= 65535
			&& typeof record.logFile === 'string' && record.workbench?.status === 'ready' && typeof record.workbench.windowId === 'string') {
			return record as PreviewHubPideLaunch;
		}
	}
	return undefined;
}
