/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { getPreviewHubPideWindowArgs, openPreviewHubPideWindow } from '../../node/PreviewHubPideWindowService.js';

suite('PreviewHubPideWindow', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps existing profile identity, requests a new window, and drops debug ports and workspace flags', () => {
		assert.deepStrictEqual(getPreviewHubPideWindowArgs('Pide . --disable-extension=test --user-data-dir=/profile/user-data --extensions-dir=/profile/extensions --shared-data-dir=/profile/shared --remote-debugging-port=1234 --disable-workspace-trust'), [
			'scripts/code.sh', '--new-window', '--user-data-dir=/profile/user-data', '--extensions-dir=/profile/extensions', '--shared-data-dir=/profile/shared',
		]);
		assert.deepStrictEqual(getPreviewHubPideWindowArgs('Pide . --user-data-dir="/profile with spaces/user-data" --extensions-dir=\'/profile with spaces/extensions\' --inspect=1234'), [
			'scripts/code.sh', '--new-window', '--user-data-dir=/profile with spaces/user-data', '--extensions-dir=/profile with spaces/extensions',
		]);
		assert.throws(() => getPreviewHubPideWindowArgs('Pide . --inspect=1234'), /Could not identify/);
	});

	test('every request invokes the existing dev launcher again rather than suppressing repeated windows', async function () {
		if (process.platform !== 'darwin') { this.skip(); }
		const root = await mkdtemp(join(tmpdir(), 'preview-hub-window-'));
		try {
			await mkdir(join(root, 'scripts/code-oss-launcher'), { recursive: true });
			await writeFile(join(root, 'scripts/code-oss-launcher/waitForWorkbench.ts'), `console.log(JSON.stringify(process.argv[4] === '--list' ? ['existing-window'] : { status: 'ready', windowId: 'new-window' }));`);
			await writeFile(join(root, 'scripts/code.sh'), 'printf "%s\\n" "$@" >> "$PWD/window-requests"\n');
			const command = 'Pide . --user-data-dir=/existing/profile --shared-data-dir=/existing/shared --remote-debugging-port=1234';
			await openPreviewHubPideWindow(root, command, process.env, process.pid);
			await openPreviewHubPideWindow(root, command, process.env, process.pid);
			assert.deepStrictEqual((await readFile(join(root, 'window-requests'), 'utf8')).trim().split('\n'), [
				'--new-window', '--user-data-dir=/existing/profile', '--shared-data-dir=/existing/shared',
				'--new-window', '--user-data-dir=/existing/profile', '--shared-data-dir=/existing/shared',
			]);
		} finally { await rm(root, { recursive: true, force: true }); }
	});
});
