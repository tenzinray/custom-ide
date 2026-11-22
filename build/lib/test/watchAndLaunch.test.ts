/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, test } from 'node:test';

suite('watch-and-launch', { skip: process.platform === 'win32' }, () => {
	for (const missingStep of [undefined, 'Pi runtime bundle', 'client typecheck']) {
		test(missingStep ? `reports missing ${missingStep} without launching` : 'launches after current build output and reuses a ready watcher', async () => {
			const root = await mkdtemp(join(tmpdir(), 'watch-and-launch-'));
			const groups: number[] = [];
			try {
				await Promise.all(['scripts', 'node_modules', 'bin'].map(folder => mkdir(join(root, folder))));
				await copyFile(new URL('../../../scripts/watch-and-launch.sh', import.meta.url), join(root, 'scripts/watch-and-launch.sh'));
				const commands = {
					node: '#!/bin/bash\nif [[ "$1" == *launch.ts ]]; then printf "%s\\n" "$@" > launched; fi\n',
					pnpm: `#!/bin/bash
printf '%s\\n' '[watch-client-transpile] Finished transpilation with 0 errors after 200 ms' '[watch-client          ] Finished compilation api-proposal-names with 0 errors' '[watch-extensions      ] Finished compilation'
${missingStep !== 'client typecheck' ? `printf '[watch-client          ] Finished \\033[32mwatch-client-noEmit\\033[39m src/tsconfig.json with 0 errors.\\n'` : ''}
${missingStep !== 'Pi runtime bundle' ? `printf '\\033[32m[watch-extensions      ] [pi-chat] Runtime bundle and image decoder built\\033[39m\\n'` : ''}
while true; do /bin/sleep 1; done
`,
					// Keep timeout coverage fast without changing the production deadline.
					sleep: '#!/bin/bash\n/bin/sleep 0.01\n',
				};
				for (const [name, content] of Object.entries(commands)) {
					const path = join(root, 'bin', name);
					await writeFile(path, content);
					await chmod(path, 0o755);
				}
				const run = () => {
					const result = spawnSync('/bin/bash', ['scripts/watch-and-launch.sh', '--preview-hub'], {
						cwd: root, env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}` },
						encoding: 'utf8', timeout: 15_000, detached: true,
					});
					groups.push(result.pid);
					assert.ifError(result.error);
					return result;
				};
				const first = run();
				if (!missingStep) {
					assert.strictEqual(first.status, 0, first.stdout + first.stderr);
					assert.match(first.stdout, /Initial watch build ready.*Launching the dev app/);
					assert.match(await readFile(join(root, 'launched'), 'utf8'), /--persistent-profile\n--wait/);
					const second = run();
					assert.strictEqual(second.status, 0, second.stdout + second.stderr);
					assert.match(second.stdout, /Reusing watcher/);
				} else {
					assert.strictEqual(first.status, 1, first.stdout + first.stderr);
					assert.match(first.stdout, /Build pending.*watcher PID \d+/);
					assert.ok(first.stderr.includes(`Timed out waiting for the watch build: ${missingStep}`), first.stderr);
					await assert.rejects(readFile(join(root, 'launched')), { code: 'ENOENT' });
				}
			} finally {
				for (const pid of groups) {
					try { process.kill(-pid, 'SIGKILL'); } catch (error) { assert.strictEqual((error as NodeJS.ErrnoException).code, 'ESRCH'); }
				}
				await rm(root, { recursive: true, force: true });
			}
		});
	}
});
