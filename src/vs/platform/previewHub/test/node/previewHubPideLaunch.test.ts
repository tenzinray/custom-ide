/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { PreviewHubPideLaunch } from '../../common/preview-hub-types.js';
import { getPreviewHubPideProfile, readPreviewHubPideLaunch } from '../../node/PreviewHubPideLaunchService.js';
import { appendPreviewHubLog, previewHubLogMaxBytes, previewHubReadyFilePath } from '../../node/previewHubLogs.js';

suite('PreviewHubPideLaunch', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('resolves profile overrides through the canonical launcher without creating a profile', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'preview-hub-profile-'));
		try {
			assert.strictEqual(await getPreviewHubPideProfile(process.cwd(), { ...process.env, CODE_OSS_DEV_PERSISTENT_PROFILE_DIR: join(directory, 'permanent') }), join(directory, 'permanent/user-data'));
		} finally { await rm(directory, { recursive: true, force: true }); }
	});

	test('requires this attempt, this profile, and a rendered-workbench acknowledgement', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'preview-hub-ready-'));
		const path = join(directory, 'attempt.log');
		const ready: PreviewHubPideLaunch = { attemptId: 'my-attempt', pid: 123, cdpPort: 9222, userDataDir: '/my/profile', logFile: '/app.log', workbench: { status: 'ready', windowId: 'my-window' } };
		try {
			await writeFile(path, `build progress\n{invalid-json\n${JSON.stringify({ ...ready, attemptId: 'some-agent' })}\n${JSON.stringify({ ...ready, workbench: undefined })}\n`);
			const before = await readPreviewHubPideLaunch(path, ready.attemptId, ready.userDataDir);
			await writeFile(path, JSON.stringify(ready));
			const after = await readPreviewHubPideLaunch(path, ready.attemptId, ready.userDataDir);
			assert.deepStrictEqual({ before, after }, { before: undefined, after: ready });
			await assert.rejects(() => readPreviewHubPideLaunch(path, ready.attemptId, '/different/profile'), /different profile/);
			await writeFile(previewHubReadyFilePath(path), JSON.stringify(ready));
			await appendPreviewHubLog(path, Buffer.alloc(previewHubLogMaxBytes * 3, 'x'));
			assert.deepStrictEqual(await readPreviewHubPideLaunch(path, ready.attemptId, ready.userDataDir), ready, 'Text rotation must not remove startup readiness');
		} finally { await rm(directory, { recursive: true, force: true }); }
	});
});
