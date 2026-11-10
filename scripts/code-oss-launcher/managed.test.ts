/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, promises as fs } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import * as path from 'node:path';
import { test } from 'node:test';
import { queueProfileMigration } from './lib/persistentProfile.ts';
import { collectGarbage, PERSISTENT_PROFILE_MARKER, PROFILE_MIGRATION_MARKER, writeState } from './lib/runDirs.ts';

const launcher = path.join(import.meta.dirname, 'launch.ts');
const cleanup = path.join(import.meta.dirname, 'cleanup', 'cleanup.ts');

interface IReadiness {
	readonly pid: number;
	readonly runDir: string;
	readonly userDataDir: string;
	readonly sharedDataDir: string;
	readonly extensionsDir: string;
	readonly cdpPort: number;
}

interface ILaunch {
	readonly child: ChildProcess;
	readonly exited: Promise<number | null>;
	readonly ready: Promise<IReadiness>;
	readonly startedFile: string;
	readonly readyFile: string;
	readonly exitFile: string;
	readonly stdout: () => string;
	readonly stderr: () => string;
}

test('managed launcher readiness, lifetime, isolation, forwarding and exact-run cleanup', { timeout: 120_000 }, async t => {
	const root = await fs.mkdtemp(path.join(import.meta.dirname, '.managed-test-'));
	const repo = path.join(root, 'repo');
	const source = path.join(root, 'source');
	const shared = path.join(root, 'shared');
	const runRoot = path.join(root, 'runs');
	const env: NodeJS.ProcessEnv = { ...process.env, CODE_OSS_DEV_RUN_ROOT: runRoot, CODE_OSS_DEV_AUTHED_SHARED_DATA_DIR: shared, CODE_OSS_DEV_REUSE: '0', CODE_OSS_DEV_PERSISTENT_PROFILE_DIR: path.join(root, 'permanent'), CODE_OSS_DEV_PROFILE_MIGRATION_FILE: path.join(root, 'migration.json') };
	delete env.CODE_OSS_DEV_SCRIPT_ARGS;
	delete env.CODE_OSS_DEV_STDOUT_FILE;
	delete env.CODE_OSS_DEV_STDERR_FILE;
	const launches: ILaunch[] = [];

	async function start(name: string, extra: string[] = [], launcherArgs: string[] = [], overrides: NodeJS.ProcessEnv = {}): Promise<ILaunch> {
		const startedFile = path.join(root, `${name}.started.json`);
		const readyFile = path.join(root, `${name}.ready`);
		const exitFile = path.join(root, `${name}.exit`);
		const child = spawn(process.execPath, [launcher, '--repo', repo, '--wait', '--skip-prelaunch', '--session-title', 'Managed $ test', '--disable-workspace-trust', '--source-user-data-dir', source, ...launcherArgs, '--',
			`--fixture-started=${startedFile}`, `--fixture-ready=${readyFile}`, `--fixture-exit=${exitFile}`, ...extra, '--extensionDevelopmentPath=extension & 100% with spaces', 'workspace with spaces'], { env: { ...env, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stderr!.on('data', chunk => { stderr += chunk; });
		const exited = once(child, 'exit').then(([code]) => code as number | null);
		const ready = new Promise<IReadiness>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`Readiness timed out: ${stderr}`)), 30_000);
			timer.unref();
			child.once('error', reject);
			child.stdout!.on('data', chunk => {
				stdout += chunk;
				if (stdout.includes('\n')) {
					clearTimeout(timer);
					try {
						resolve(JSON.parse(stdout.trim()));
					} catch (error) {
						reject(error);
					}
				}
			});
			void exited.then(code => {
				clearTimeout(timer);
				if (!stdout.includes('\n')) {
					reject(new Error(`Launcher exited ${code} before readiness: ${stderr}`));
				}
			});
		});
		// Failures before readiness are asserted by the individual test below.
		void ready.catch(() => { });
		const launch = { child, exited, ready, startedFile, readyFile, exitFile, stdout: () => stdout, stderr: () => stderr };
		launches.push(launch);
		return launch;
	}

	async function stop(runDir: string): Promise<{ removed: boolean }> {
		const child = spawn(process.execPath, [cleanup, runDir], { env, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout!.on('data', chunk => { stdout += chunk; });
		child.stderr!.on('data', chunk => { stderr += chunk; });
		const [code] = await once(child, 'exit');
		assert.equal(code, 0, stderr);
		return JSON.parse(stdout);
	}

	try {
		await fs.mkdir(path.join(repo, 'scripts'), { recursive: true });
		await fs.writeFile(path.join(repo, 'product.json'), JSON.stringify({ nameShort: 'Code', sharedDataFolderName: '.unused' }));
		await fs.writeFile(path.join(repo, 'index.js'), stripTypeScriptTypes(
			await fs.readFile(path.join(import.meta.dirname, 'fixtures', 'fakeCode.ts'), 'utf8'),
		));
		if (process.platform === 'win32') {
			await fs.mkdir(path.join(repo, '.build', 'electron'), { recursive: true });
			await fs.writeFile(path.join(repo, 'scripts', 'code.bat'), '');
			await fs.copyFile(process.execPath, path.join(repo, '.build', 'electron', 'Code.exe'));
		} else {
			const quote = (value: string) => `'${value.replaceAll('\'', '\'\\\'\'')}'`;
			await fs.writeFile(path.join(repo, 'scripts', 'code.sh'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(repo, 'index.js'))} "$@"\n`, { mode: 0o755 });
		}
		for (const [relative, content] of Object.entries({
			'User/settings.json': '{"editor.fontSize": 14}',
			'User/globalStorage/state.vscdb': 'synthetic auth state',
			'Local State': 'synthetic encryption state',
			'machineid': 'synthetic machine',
			'Network/Cookies': 'synthetic cookie',
			'logs/old.log': 'excluded',
		})) {
			await fs.mkdir(path.dirname(path.join(source, relative)), { recursive: true });
			await fs.writeFile(path.join(source, relative), content);
		}
		await fs.mkdir(shared, { recursive: true });
		await fs.writeFile(path.join(shared, 'seed'), 'synthetic shared state');

		await t.test('emits one readiness record only after CDP and waits for the application exit code', async () => {
			const launch = await start('lifetime');
			await waitUntil(() => existsSync(launch.startedFile));
			assert.equal(launch.stdout(), '');
			assert.equal(launch.child.exitCode, null);
			await fs.writeFile(launch.readyFile, '');
			const record = await launch.ready;
			assert.notEqual(record.userDataDir, source);
			assert.equal(path.dirname(record.runDir), runRoot);
			assert.equal(await fs.readFile(path.join(record.userDataDir, 'Network', 'Cookies'), 'utf8'), 'synthetic cookie');
			assert.equal(existsSync(path.join(record.userDataDir, 'logs', 'old.log')), false);
			assert.equal(await fs.readFile(path.join(source, 'User', 'settings.json'), 'utf8'), '{"editor.fontSize": 14}');
			const settings = JSON.parse(await fs.readFile(path.join(record.userDataDir, 'User', 'settings.json'), 'utf8'));
			assert.equal(settings['files.simpleDialog.enable'], true);
			assert.equal(settings['window.title'], 'Managed ＄ test${separator}${rootName}${separator}${appName}');
			const args: string[] = JSON.parse(await fs.readFile(launch.startedFile, 'utf8'));
			assert.ok(args.includes('--disable-workspace-trust'));
			assert.ok(args.includes('--extensionDevelopmentPath=extension & 100% with spaces'));
			assert.equal(args.at(-1), 'workspace with spaces');
			assert.equal(launch.child.exitCode, null);
			assert.equal(launch.stdout().trim().split('\n').length, 1);
			if (process.platform === 'win32') {
				assert.equal(await fs.readFile(path.join(record.sharedDataDir, 'seed'), 'utf8'), 'synthetic shared state');
			}
			await fs.writeFile(launch.exitFile, '');
			assert.equal(await launch.exited, 23, launch.stderr());
			assert.deepStrictEqual(await stop(record.runDir), { runDir: record.runDir, stopped: false, removed: true });
			assert.equal(existsSync(record.runDir), false);
		});

		await t.test('cleanup stops only the named run while another managed launch remains alive', async () => {
			const first = await start('first');
			const second = await start('second');
			await fs.writeFile(first.readyFile, '');
			await fs.writeFile(second.readyFile, '');
			const [firstRecord, secondRecord] = await Promise.all([first.ready, second.ready]);
			await stop(firstRecord.runDir);
			await first.exited;
			assert.equal(second.child.exitCode, null);
			process.kill(secondRecord.pid, 0);
			assert.equal(existsSync(secondRecord.userDataDir), true);
			await stop(secondRecord.runDir);
			await second.exited;
		});

		await t.test('opt-in application-shared state survives fresh profiles and exact-run cleanup', async () => {
			const first = await start('persistent-first', [], ['--persistent-shared-data']);
			await fs.writeFile(first.readyFile, '');
			const firstRecord = await first.ready;
			await fs.writeFile(path.join(firstRecord.sharedDataDir, 'retained-state'), 'retained application state');
			await stop(firstRecord.runDir);
			await first.exited;
			const second = await start('persistent-second', [], ['--persistent-shared-data']);
			await fs.writeFile(second.readyFile, '');
			const secondRecord = await second.ready;
			assert.deepStrictEqual({
				firstShared: firstRecord.sharedDataDir,
				secondShared: secondRecord.sharedDataDir,
				freshProfile: secondRecord.userDataDir !== firstRecord.userDataDir,
				state: await fs.readFile(path.join(secondRecord.sharedDataDir, 'retained-state'), 'utf8'),
			}, { firstShared: shared, secondShared: shared, freshProfile: true, state: 'retained application state' });
			await stop(secondRecord.runDir);
			await second.exited;
			assert.equal(await fs.readFile(path.join(shared, 'retained-state'), 'utf8'), 'retained application state');
		});

		await t.test('permanent launches retain later settings, login state and extensions without resyncing', async () => {
			const first = await start('permanent-first', [], ['--persistent-profile']);
			await fs.writeFile(first.readyFile, '');
			const record = await first.ready;
			const blocked = await start('permanent-already-running', [], ['--persistent-profile']);
			await assert.rejects(blocked.ready, /before readiness/);
			assert.equal(await blocked.exited, 2);
			assert.equal(first.child.exitCode, null);
			await fs.writeFile(path.join(record.userDataDir, 'User/settings.json'), '{"editor.fontSize":21}');
			await fs.writeFile(path.join(record.userDataDir, 'User/globalStorage/state.vscdb'), 'signed in after setup');
			await fs.mkdir(path.join(record.extensionsDir, 'later-extension'), { recursive: true });
			await fs.writeFile(path.join(record.extensionsDir, 'later-extension/package.json'), '{}');
			await fs.writeFile(first.exitFile, '');
			await first.exited;
			await fs.writeFile(path.join(source, 'User/settings.json'), '{"editor.fontSize":99}');
			const second = await start('permanent-second', [], ['--persistent-profile']);
			await fs.writeFile(second.readyFile, '');
			const next = await second.ready;
			assert.deepStrictEqual({
				profileUnchanged: next.userDataDir === record.userDataDir,
				settings: await fs.readFile(path.join(next.userDataDir, 'User/settings.json'), 'utf8'),
				login: await fs.readFile(path.join(next.userDataDir, 'User/globalStorage/state.vscdb'), 'utf8'),
				extensionKept: existsSync(path.join(next.extensionsDir, 'later-extension/package.json')),
			}, { profileUnchanged: true, settings: '{"editor.fontSize":21}', login: 'signed in after setup', extensionKept: true });
			await fs.writeFile(second.exitFile, '');
			await second.exited;
			const remove = spawn(process.execPath, [cleanup, record.runDir], { env, stdio: 'ignore' });
			const [code] = await once(remove, 'exit');
			assert.equal(code, 2);
			assert.equal(existsSync(record.userDataDir), true);
			await fs.writeFile(path.join(source, 'User/settings.json'), '{"editor.fontSize":14}');
		});

		await t.test('queued migration waits for source exit and keeps workspace state, backups, extensions and shared data', async () => {
			const live = await start('migration-source');
			await fs.writeFile(live.readyFile, '');
			const record = await live.ready;
			for (const [relative, content] of Object.entries({ 'User/workspaceStorage/workspace/state': 'layout and pins', 'Backups/unsaved': 'unsaved content', 'extensions/current-extension/package.json': '{}' })) {
				await fs.mkdir(path.dirname(path.join(record.userDataDir, relative)), { recursive: true });
				await fs.writeFile(path.join(record.userDataDir, relative), content);
			}
			await fs.writeFile(path.join(record.sharedDataDir, 'trust-state'), 'existing trust');
			const directory = path.join(root, 'from-current-window');
			const migrationFile = path.join(root, 'current-window-migration.json');
			const overrides = { CODE_OSS_DEV_PERSISTENT_PROFILE_DIR: directory, CODE_OSS_DEV_PROFILE_MIGRATION_FILE: migrationFile };
			await queueProfileMigration({ sourceUserDataDir: record.userDataDir, sourceExtensionsDir: record.extensionsDir, sourceSharedDataDir: record.sharedDataDir }, migrationFile, directory);
			const blocked = await start('migration-while-live', [], ['--persistent-profile'], overrides);
			await assert.rejects(blocked.ready, /before readiness/);
			assert.equal(await blocked.exited, 1);
			assert.match(blocked.stderr(), /Quit the source Code OSS app completely/);
			assert.equal(existsSync(directory), false);
			assert.equal(live.child.exitCode, null);
			await fs.writeFile(live.exitFile, '');
			await live.exited;
			await writeState(record.runDir, { kind: 'fresh', codePid: record.pid, lastUsedAt: 0 });
			await collectGarbage(runRoot);
			assert.equal(existsSync(record.userDataDir), true, 'GC must keep a pending migration source');
			const migrated = await start('migration-after-quit', [], ['--persistent-profile'], overrides);
			await fs.writeFile(migrated.readyFile, '');
			const next = await migrated.ready;
			assert.deepStrictEqual({
				workspaceState: await fs.readFile(path.join(next.userDataDir, 'User/workspaceStorage/workspace/state'), 'utf8'),
				backup: await fs.readFile(path.join(next.userDataDir, 'Backups/unsaved'), 'utf8'),
				extension: existsSync(path.join(next.extensionsDir, 'current-extension/package.json')),
				trust: await fs.readFile(path.join(next.sharedDataDir, 'trust-state'), 'utf8'),
				planRemoved: !existsSync(migrationFile), sourceReleased: !existsSync(path.join(record.runDir, PROFILE_MIGRATION_MARKER)),
			}, { workspaceState: 'layout and pins', backup: 'unsaved content', extension: true, trust: 'existing trust', planRemoved: true, sourceReleased: true });
			await fs.writeFile(migrated.exitFile, '');
			await migrated.exited;
		});

		await t.test('garbage collection recognizes a live replacement process even with a stale recorded PID', async () => {
			const launch = await start('replacement-pid');
			await fs.writeFile(launch.readyFile, '');
			const record = await launch.ready;
			await writeState(record.runDir, { kind: 'fresh', codePid: 2147483647, lastUsedAt: 0 });
			await collectGarbage(runRoot);
			assert.equal(existsSync(record.userDataDir), true);
			assert.equal(launch.child.exitCode, null);
			await fs.writeFile(launch.exitFile, '');
			await launch.exited;
			await stop(record.runDir);
		});

		await t.test('garbage collection and forced cleanup protect permanent profiles and queued sources', async () => {
			for (const [index, marker] of [PERSISTENT_PROFILE_MARKER, PROFILE_MIGRATION_MARKER].entries()) {
				const directory = path.join(runRoot, `reuse-protected-${index}`);
				await fs.mkdir(directory, { recursive: true });
				await writeState(directory, { kind: 'reuse', lastUsedAt: 0 });
				await fs.writeFile(path.join(directory, marker), '{}');
				await collectGarbage(runRoot);
				const remove = spawn(process.execPath, [cleanup, directory, '--remove'], { env, stdio: 'ignore' });
				const [code] = await once(remove, 'exit');
				assert.deepStrictEqual({ code, preserved: existsSync(directory) }, { code: 2, preserved: true });
			}
		});

		await t.test('early application exit fails without emitting readiness JSON', async () => {
			const launch = await start('early', ['--fixture-exit-before-ready']);
			await assert.rejects(launch.ready, /before readiness/);
			assert.equal(await launch.exited, 1);
			assert.equal(launch.stdout(), '');
		});

		await t.test('does not permit forwarded arguments to override run isolation', async () => {
			const launch = await start('override', ['--user-data-dir=somewhere-else']);
			await assert.rejects(launch.ready, /launcher owns --user-data-dir/);
			assert.equal(await launch.exited, 2);
			assert.equal(existsSync(launch.startedFile), false);
		});

		await t.test('cleanup refuses an unrelated directory even inside the run root', async () => {
			const unrelated = path.join(runRoot, 'unrelated');
			await fs.mkdir(unrelated, { recursive: true });
			await fs.writeFile(path.join(unrelated, 'keep'), 'not launcher-owned');
			const child = spawn(process.execPath, [cleanup, unrelated], { env, stdio: ['ignore', 'pipe', 'pipe'] });
			child.stdout!.resume();
			child.stderr!.resume();
			const [code] = await once(child, 'exit');
			assert.equal(code, 2);
			assert.equal(await fs.readFile(path.join(unrelated, 'keep'), 'utf8'), 'not launcher-owned');
		});
	} finally {
		for (const launch of launches) {
			await fs.writeFile(launch.exitFile, '');
		}
		for (const launch of launches) {
			await Promise.race([launch.exited, new Promise(resolve => setTimeout(resolve, 3000))]);
			if (launch.child.exitCode === null && launch.child.signalCode === null) {
				launch.child.kill();
			}
		}
		await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
	}
});

async function waitUntil(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 20_000;
	while (!predicate()) {
		assert.ok(Date.now() < deadline, 'Timed out waiting for fake Code OSS to start');
		await new Promise(resolve => setTimeout(resolve, 25));
	}
}
