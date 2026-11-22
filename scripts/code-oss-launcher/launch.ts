/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Launches Code OSS (VS Code from sources) with an isolated copy of a user-data-dir and unique
// debugger ports. Prints exactly one JSON line to stdout once the renderer's CDP endpoint is
// ready; all diagnostics go to stderr. With --wait the launcher owns the application's lifetime.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, promises as fs, readFileSync } from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { isExcludedFromProfileCopy, syncExtensions, syncTree, UnknownExtensionsError, validateExtensionSelection, type ExtensionSelection, type ITreeManifest } from './lib/profileCopy.ts';
import { claimReuseRunDir, claimRunDir, collectGarbage, createFreshRunDir, getRunRoot, getTempRunRoot, releaseClaim, stopCodeProcesses, writeState } from './lib/runDirs.ts';
import { writeStderr, writeStdout } from './lib/output.ts';
import { updateLaunchSettings } from './lib/settings.ts';
import { preparePersistentProfile } from './lib/persistentProfile.ts';
import { waitForCdp } from './waitForCdp.ts';
import { waitForWorkbench, type WorkbenchWaitResult } from './waitForWorkbench.ts';
import { capturePreviewHubProcessLogs } from '../../src/vs/platform/previewHub/node/previewHubLogs.ts';

const CDP_TIMEOUT_MS = 90_000;

interface ILaunchOptions {
	readonly agents: boolean;
	readonly sessionTitle: string;
	readonly sourceUserDataDir: string | undefined;
	readonly repo: string | undefined;
	/** `undefined` starts with an empty extensions folder */
	readonly extensions: ExtensionSelection | undefined;
	readonly full: boolean;
	readonly skipPreLaunch: boolean;
	readonly disableWorkspaceTrust: boolean;
	readonly persistentSharedData: boolean;
	readonly persistentProfile: boolean;
	readonly reuse: boolean;
	readonly wait: boolean;
	readonly extraArgs: readonly string[];
}

/**
 * What a reused run directory remembers about its copies, to sync them on the next launch.
 */
interface IReuseManifest {
	readonly version: 1;
	readonly profile?: ITreeManifest;
	readonly sharedData?: ITreeManifest;
	readonly extensionFolders?: readonly string[];
}

class UsageError extends Error { }

function log(message: string): void {
	const attempt = process.env.PREVIEW_HUB_ATTEMPT_ID;
	writeStderr(`[launch] ${attempt ? `[${attempt}] ${new Date().toISOString()} ` : ''}${message}\n`);
}

function readArguments(): { args: string[]; fromPowerShell: boolean } {
	// The PowerShell wrapper passes arguments as JSON, which survives Windows PowerShell's native argument quoting
	const json = process.env.CODE_OSS_DEV_SCRIPT_ARGS;
	delete process.env.CODE_OSS_DEV_SCRIPT_ARGS;
	return json ? { args: JSON.parse(json), fromPowerShell: true } : { args: process.argv.slice(2), fromPowerShell: false };
}

function parseArguments(args: readonly string[], fromPowerShell: boolean): ILaunchOptions {
	let agents = false;
	let sessionTitle = '';
	let sourceUserDataDir: string | undefined;
	let repo: string | undefined;
	let extensions: ExtensionSelection | undefined;
	let full = false;
	let skipPreLaunch = false;
	let disableWorkspaceTrust = false;
	let persistentSharedData = false;
	let persistentProfile = false;
	let reuse = process.env.CODE_OSS_DEV_REUSE === '1';
	let wait = false;
	let extraArgs: string[] = [];

	const value = (index: number, name: string) => {
		if (index + 1 >= args.length || args[index + 1].startsWith('--')) {
			throw new UsageError(`Missing value for ${name}.`);
		}
		return args[index + 1];
	};
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		const [name, inlineValue] = argument.startsWith('--') && argument.includes('=') ? [argument.slice(0, argument.indexOf('=')), argument.slice(argument.indexOf('=') + 1)] : [argument, undefined];
		switch (name) {
			case '--help':
				writeStdout('Usage: node scripts/code-oss-launcher/launch.ts --repo <root> [--wait] [--skip-prelaunch] [--session-title <title>] [--source-user-data-dir <profile>] [--copy-extensions[=<id,...>]] [--full] [--reuse|--fresh] [--agents] [--disable-workspace-trust] [--persistent-shared-data] [--persistent-profile] -- <Code OSS arguments>\n');
				process.exit(0);
			case '--agents': agents = true; break;
			case '--session-title': sessionTitle = inlineValue ?? value(index++, name); break;
			case '--source-user-data-dir': sourceUserDataDir = inlineValue ?? value(index++, name); break;
			case '--repo': repo = inlineValue ?? value(index++, name); break;
			case '--clone-extensions':
			case '--copy-extensions': {
				if (inlineValue === undefined) {
					extensions = { kind: 'all' };
					break;
				}
				// Commas or spaces: PowerShell turns an unquoted `a,b` argument into `a b`
				const ids = inlineValue.split(/[\s,]+/).filter(id => id.length > 0);
				if (ids.length === 0) {
					throw new UsageError(`Missing extension IDs for ${name}=<id,...>.`);
				}
				extensions = { kind: 'ids', ids };
				break;
			}
			case '--full': full = true; break;
			case '--skip-prelaunch': skipPreLaunch = true; break;
			case '--disable-workspace-trust': disableWorkspaceTrust = true; break;
			case '--persistent-shared-data': persistentSharedData = true; break;
			case '--persistent-profile': persistentProfile = true; break;
			case '--reuse': reuse = true; break;
			case '--fresh': reuse = false; break;
			case '--wait': wait = true; break;
			case '--': extraArgs = args.slice(index + 1); index = args.length; break;
			default:
				// PowerShell drops an unquoted `--`, so a workspace path also starts the arguments for Code
				if (!argument.startsWith('-')) {
					extraArgs = args.slice(index);
					index = args.length;
					break;
				}
				throw new UsageError(`Unknown arg: ${argument}${fromPowerShell ? `. To pass it to Code OSS, put it after '--', quoted: PowerShell drops an unquoted --.` : ''}`);
		}
	}
	for (const argument of extraArgs) {
		if (/^--(?:user-data-dir|extensions-dir|shared-data-dir|remote-debugging-port|inspect(?:-extensions|-agenthost)?)(?:=|$)/.test(argument)) {
			throw new UsageError(`The launcher owns ${argument.split('=')[0]}; it cannot be overridden.`);
		}
	}
	return { agents, sessionTitle, sourceUserDataDir, repo, extensions, full, skipPreLaunch, disableWorkspaceTrust, persistentSharedData, persistentProfile, reuse, wait, extraArgs };
}

async function main(): Promise<number> {
	const startedAt = performance.now();
	const { args, fromPowerShell } = readArguments();
	const options = parseArguments(args, fromPowerShell);

	const repo = path.resolve(options.repo ?? process.cwd());
	const codeScript = path.join(repo, 'scripts', process.platform === 'win32' ? 'code.bat' : 'code.sh');
	if (!existsSync(codeScript)) {
		throw new UsageError(options.repo ? `Could not find a Code OSS launcher at ${codeScript}. Pass --repo <vscode-repo-root>.` : `Could not find a vscode checkout in ${repo}. Pass --repo <vscode-repo-root>.`);
	}

	const sourceUserDataDir = path.resolve(options.sourceUserDataDir ?? process.env.CODE_OSS_DEV_AUTHED_USER_DATA_DIR ?? path.join(os.homedir(), '.vscode-oss-dev'));
	const sourceProfileExists = await isDirectory(sourceUserDataDir);
	if (!sourceProfileExists && !options.persistentProfile) {
		log(`no source profile at ${sourceUserDataDir}; launching with an empty isolated profile so the user can sign in.`);
	}
	const [cdpPort, extHostPort, mainPort, agentHostPort] = await allocatePorts(4);
	if (options.extensions?.kind === 'ids' && sourceProfileExists && !options.full) {
		await validateExtensionSelection(path.join(sourceUserDataDir, 'extensions'), options.extensions.ids);
	}

	log(`profile preparation started; runtime ${process.execPath} ${process.version}`);
	const { runDir, reused } = await createRunDir(repo, sourceUserDataDir, options);
	let codePid: number | undefined;
	let disposeSignalHandlers: (() => void) | undefined;
	let receivedSignal: NodeJS.Signals | undefined;
	try {
		const userDataDir = path.join(runDir, 'user-data');
		const extensionsDir = path.join(userDataDir, 'extensions');
		const sharedDataDir = options.persistentSharedData && !options.persistentProfile ? getSourceSharedDataDir(repo) : path.join(runDir, 'shared-data');
		const logFile = path.join(runDir, 'code.log');
		await fs.writeFile(logFile, '');
		log(`${reused ? 'reusing' : 'created'} run directory ${runDir}`);

		const preLaunch = options.skipPreLaunch ? undefined : runPreLaunch(repo, logFile);
		const hasGitHubSession = await prepareProfile(repo, sourceUserDataDir, sourceProfileExists, runDir, userDataDir, extensionsDir, sharedDataDir, reused, options);
		const profileReadyAt = performance.now();
		log(`profile preparation finished; user-data-dir=${userDataDir}, elapsed=${Math.round(profileReadyAt - startedAt)}ms`);

		if (preLaunch) {
			if (!await preLaunch) {
				log('pre-launch FAILED. Log tail:');
				writeLogTail(logFile);
				return 1;
			}
		} else {
			log('skipping pre-launch by request');
		}
		const preLaunchReadyAt = performance.now();

		const launchArgs = [
			...(options.agents ? ['--agents'] : []),
			`--user-data-dir=${userDataDir}`,
			`--extensions-dir=${extensionsDir}`,
			`--shared-data-dir=${sharedDataDir}`,
			`--remote-debugging-port=${cdpPort}`,
			`--inspect-extensions=${extHostPort}`,
			`--inspect=${mainPort}`,
			`--inspect-agenthost=${agentHostPort}`,
			...(options.disableWorkspaceTrust ? ['--disable-workspace-trust'] : []),
			...(options.agents && options.sessionTitle ? [`--session-title-base64=${Buffer.from(options.sessionTitle, 'utf8').toString('base64url')}`] : []),
			...options.extraArgs,
		];
		log(`logs: ${logFile}`);
		const code = await startCode(repo, codeScript, launchArgs, logFile, options.wait);
		const pid = code.pid;
		codePid = pid;
		log(`application spawned; PID=${pid}, CDP=${cdpPort}`);
		if (options.wait) {
			const onSignal = (signal: NodeJS.Signals) => {
				receivedSignal = signal;
				stopCodeProcesses(runDir, pid);
			};
			process.on('SIGINT', onSignal);
			process.on('SIGTERM', onSignal);
			disposeSignalHandlers = () => {
				process.off('SIGINT', onSignal);
				process.off('SIGTERM', onSignal);
			};
		}
		await writeState(runDir, { kind: reused ? 'reuse' : 'fresh', codePid: pid, lastUsedAt: Date.now() });

		log(`waiting for CDP on port ${cdpPort} (timeout ${CDP_TIMEOUT_MS / 1000}s)...`);
		const ready = await waitForCdp(pid, cdpPort, CDP_TIMEOUT_MS);
		if (ready.status !== 'ready') {
			log(ready.status === 'timeout' ? `timed out waiting for CDP on port ${cdpPort}. Log tails:` : `Code OSS (PID ${pid}) exited before CDP came up. Log tails:`);
			await writeApplicationLogTails(logFile, userDataDir);
			stopCodeProcesses(runDir, pid);
			if (options.wait) {
				await code.exited;
			}
			return 1;
		}
		log(`CDP ready after ${ready.elapsedMs}ms`);
		let workbench: WorkbenchWaitResult | undefined;
		if (process.env.PREVIEW_HUB_ATTEMPT_ID) {
			log('workbench verification started (timeout 30s)');
			workbench = await waitForWorkbench(pid, cdpPort, 30_000, log);
			if (workbench.status !== 'ready') {
				log(`WORKBENCH ${workbench.status}: ${workbench.detail}. Application log tails:`);
				await writeApplicationLogTails(logFile, userDataDir);
				stopCodeProcesses(runDir, pid);
				if (options.wait) { await code.exited; }
				return 1;
			}
			log(`workbench rendered; window=${workbench.windowId}, elapsed=${workbench.elapsedMs}ms`);
		}
		if (hasGitHubSession === false) {
			log(`WARNING: source profile ${sourceUserDataDir} has no stored GitHub session; the launched instance will prompt you to sign in.`);
			log('Sign in to your source Code OSS profile before launching to seed authentication. Credentials are copied locally, never printed.');
		}
		if (!options.persistentProfile) { await collectGarbage(path.dirname(runDir)); }

		const finishedAt = performance.now();
		const readiness = JSON.stringify({
			attemptId: process.env.PREVIEW_HUB_ATTEMPT_ID,
			workbench,
			pid,
			cdpPort,
			extHostPort,
			mainPort,
			agentHostPort,
			userDataDir,
			extensionsDir,
			sharedDataDir,
			runDir,
			logFile,
			repo,
			agents: options.agents,
			reused,
			timings: {
				profileMs: Math.round(profileReadyAt - startedAt),
				preLaunchMs: Math.round(preLaunchReadyAt - profileReadyAt),
				cdpReadyMs: Math.round(finishedAt - preLaunchReadyAt),
				totalMs: Math.round(finishedAt - startedAt),
			},
		}) + '\n';
		if (process.env.PREVIEW_HUB_READY_FILE) {
			await fs.writeFile(process.env.PREVIEW_HUB_READY_FILE, readiness, { mode: 0o600 });
		}
		writeStdout(readiness);
		if (options.wait) {
			const result = await code.exited;
			if (receivedSignal) {
				return receivedSignal === 'SIGINT' ? 130 : 143;
			}
			if (result.signal) {
				throw new Error(`Code OSS exited with signal ${result.signal}.`);
			}
			return result.code ?? 1;
		}
		return 0;
	} catch (error) {
		if (codePid !== undefined) {
			stopCodeProcesses(runDir, codePid);
		}
		throw error;
	} finally {
		disposeSignalHandlers?.();
		if (reused) {
			await releaseClaim(runDir);
		}
	}
}

async function createRunDir(repo: string, sourceUserDataDir: string, options: ILaunchOptions): Promise<{ runDir: string; reused: boolean }> {
	if (options.persistentProfile) {
		if (options.full || options.extensions) { throw new UsageError('A permanent profile preserves its own extensions and state; do not combine it with --full or --copy-extensions.'); }
		log('preparing the permanent profile (one-time migration only; future settings and sign-ins are preserved)');
		const runDir = await preparePersistentProfile({
			sourceUserDataDir,
			sourceExtensionsDir: path.join(sourceUserDataDir, 'extensions'),
			sourceSharedDataDir: getSourceSharedDataDir(repo),
		});
		if (!await claimRunDir(runDir)) { throw new UsageError('The permanent Code OSS app is already running or launching. Use its existing window; no profile was reset.'); }
		return { runDir, reused: true };
	}
	const root = getRunRoot(repo);
	if (options.reuse) {
		// One reused run directory per source profile and copy selection, as their contents differ
		const extensionsKey = !options.extensions ? 'none' : options.extensions.kind === 'all' ? 'all' : options.extensions.ids.map(id => id.toLowerCase()).sort().join(',');
		const profileKey = process.platform === 'linux' ? sourceUserDataDir : sourceUserDataDir.toLowerCase();
		const key = createHash('sha256').update(JSON.stringify([profileKey, options.full, extensionsKey, options.persistentSharedData])).digest('hex').slice(0, 8);
		const runDir = await claimReuseRunDir(root, key);
		if (runDir) {
			await writeState(runDir, { kind: 'reuse', launcherPid: process.pid, lastUsedAt: Date.now() });
			return { runDir, reused: true };
		}
		log('the reused run directory is in use by another launch or Code OSS; using a fresh one');
	}
	try {
		return { runDir: await createFreshRunDir(root), reused: false };
	} catch (error) {
		const fallbackRoot = getTempRunRoot();
		if (fallbackRoot === root) {
			throw error;
		}
		log(`cannot create a run directory in ${root} (${(error as Error).message}); using ${fallbackRoot}`);
		return { runDir: await createFreshRunDir(fallbackRoot), reused: false };
	}
}

/**
 * Copies or syncs the profile, shared data and extensions, and prepares settings.
 * Returns whether the source profile has a stored GitHub session, where that can be determined.
 */
async function prepareProfile(repo: string, sourceUserDataDir: string, sourceProfileExists: boolean, runDir: string, userDataDir: string, extensionsDir: string, sharedDataDir: string, reused: boolean, options: ILaunchOptions): Promise<boolean | undefined> {
	if (options.persistentProfile) {
		log(`using the permanent profile without synchronizing over it: ${userDataDir}`);
		return undefined;
	}
	const manifestFile = path.join(runDir, 'launch-manifest.json');
	const previous: IReuseManifest = reused ? await readJson<IReuseManifest>(manifestFile).then(manifest => manifest?.version === 1 ? manifest : { version: 1 }) : { version: 1 };
	await fs.mkdir(userDataDir, { recursive: true });

	// On Windows the GitHub session is APPLICATION_SHARED scoped, so it lives in the shared-data-dir
	// and not in the profile - see useSharedStorage in src/vs/platform/secrets/common/secrets.ts.
	// Without this copy the launched instance always prompts for sign-in.
	const sourceSharedDataDir = getSourceSharedDataDir(repo);
	const copiesSharedData = !options.persistentSharedData && process.platform === 'win32' && await isDirectory(sourceSharedDataDir);
	if (options.persistentSharedData) {
		log(`persistent application-shared storage (including workspace trust): ${sharedDataDir}`);
	}
	if (!options.persistentSharedData && process.platform === 'win32' && !copiesSharedData) {
		log(`no shared-data-dir at ${sourceSharedDataDir}; nothing to seed`);
	}

	const sharedDataSync = copiesSharedData ? syncTree(sourceSharedDataDir, sharedDataDir, previous.sharedData) : fs.mkdir(sharedDataDir, { recursive: true }).then(() => undefined);
	const profileSync = sourceProfileExists ? syncTree(sourceUserDataDir, userDataDir, previous.profile, options.full ? undefined : isExcludedFromProfileCopy) : Promise.resolve(undefined);
	const copiesExtensions = !options.full && options.extensions !== undefined && sourceProfileExists;
	const extensionsSync = copiesExtensions ? syncExtensions(path.join(sourceUserDataDir, 'extensions'), extensionsDir, options.extensions!, previous.extensionFolders) : fs.mkdir(extensionsDir, { recursive: true }).then(() => undefined);
	const gitHubSessionCheck = process.platform === 'win32' && sourceProfileExists ? hasGitHubSession(sourceUserDataDir, sourceSharedDataDir, runDir) : Promise.resolve(sourceProfileExists ? undefined : false);

	log(`${sourceProfileExists ? `${options.full ? 'full' : 'slim'} ${reused ? 'sync' : 'copy'}: ${sourceUserDataDir}` : 'empty profile'} -> ${userDataDir}`);
	if (copiesExtensions) {
		log(`${reused ? 'syncing' : 'copying'} extensions ${options.extensions!.kind === 'all' ? '(all)' : options.extensions!.ids.join(', ')} -> ${extensionsDir}`);
	}
	const [sharedData, profile, extensionFolders, hasSession] = await Promise.all([sharedDataSync, profileSync, extensionsSync, gitHubSessionCheck]);
	if (reused) {
		const copied = (profile?.copiedFiles ?? 0) + (sharedData?.copiedFiles ?? 0);
		const deleted = (profile?.deletedFiles ?? 0) + (sharedData?.deletedFiles ?? 0);
		log(`synced: ${copied} files copied, ${deleted} deleted`);
		const manifest: IReuseManifest = { version: 1, profile: profile?.manifest, sharedData: sharedData?.manifest, extensionFolders: extensionFolders ?? undefined };
		await fs.writeFile(manifestFile, JSON.stringify(manifest));
	}

	if (process.platform === 'win32' && sourceProfileExists && hasSession !== false) {
		const missing = ['Local State', 'machineid', 'User/globalStorage/state.vscdb', 'Network'].filter(relative => !existsSync(path.join(userDataDir, relative)));
		if (missing.length > 0) {
			throw new Error(`Profile copy is missing auth-critical path(s): ${missing.join(', ')}. Refusing to launch a profile that cannot preserve Windows authentication.`);
		}
	}

	const settingsFile = path.join(userDataDir, 'User', 'settings.json');
	await fs.mkdir(path.dirname(settingsFile), { recursive: true });
	updateLaunchSettings(settingsFile, options.agents ? undefined : options.sessionTitle, path.join(sourceUserDataDir, 'User', 'settings.json'));
	log(`ensured files.simpleDialog.enable=true in ${settingsFile}`);
	if (options.sessionTitle) {
		log(options.agents ? `set Agents command center title for session: ${options.sessionTitle}` : `set window.title for session: ${options.sessionTitle}`);
	}
	return hasSession;
}

/**
 * Mirrors IEnvironmentService.appSharedDataHome, minus the --shared-data-dir branch, which names
 * the destination and not the source: VSCODE_PORTABLE\shared-data, else ~/<product.sharedDataFolderName>.
 */
function getSourceSharedDataDir(repo: string): string {
	if (process.env.CODE_OSS_DEV_AUTHED_SHARED_DATA_DIR) {
		return process.env.CODE_OSS_DEV_AUTHED_SHARED_DATA_DIR;
	}
	if (process.env.VSCODE_PORTABLE) {
		return path.join(process.env.VSCODE_PORTABLE, 'shared-data');
	}
	return path.join(os.homedir(), readProduct(repo).sharedDataFolderName ?? '.vscode-oss-shared');
}

/**
 * Looks for a GitHub session in the databases the launch copies. On Windows it is stored in the
 * shared-data-dir; older profiles may still hold it in globalStorage, so either one counts.
 */
async function hasGitHubSession(sourceUserDataDir: string, sourceSharedDataDir: string, runDir: string): Promise<boolean | undefined> {
	let undetermined = false;
	for (const database of [path.join(sourceSharedDataDir, 'sharedStorage', 'state.vscdb'), path.join(sourceUserDataDir, 'User', 'globalStorage', 'state.vscdb')]) {
		if (!existsSync(database)) {
			continue;
		}
		// Reads a copy, as a running Code instance may be writing to the database
		const copy = path.join(runDir, `auth-preflight-${path.basename(path.dirname(database))}.vscdb`);
		try {
			await fs.copyFile(database, copy);
			const { DatabaseSync } = await import('node:sqlite');
			const db = new DatabaseSync(copy, { readOnly: true });
			try {
				if (db.prepare('SELECT 1 FROM ItemTable WHERE key LIKE ? LIMIT 1').get('secret://%github-authentication%')) {
					return true;
				}
			} finally {
				db.close();
			}
		} catch {
			undetermined = true;
		} finally {
			await fs.rm(copy, { force: true });
		}
	}
	return undetermined ? undefined : false;
}

/**
 * Runs build/lib/preLaunch.ts, which ensures Electron, compiled output and built-in extensions.
 */
function runPreLaunch(repo: string, logFile: string): Promise<boolean> {
	log('running pre-launch (ensures electron + compiled output + built-ins)...');
	const logFd = openSync(logFile, 'a');
	return new Promise<boolean>(resolve => {
		const child = spawn(process.execPath, ['build/lib/preLaunch.ts'], { cwd: repo, stdio: ['ignore', logFd, logFd] });
		child.on('error', () => resolve(false));
		child.on('exit', code => resolve(code === 0));
	}).finally(() => closeSync(logFd));
}

/**
 * Starts Code OSS detached by default, or in the caller's process tree when waiting.
 * On Windows, Electron is started directly as scripts/code.bat would after pre-launch, because
 * passing arguments through cmd.exe breaks on characters such as `&` and `%`.
 */
async function startCode(repo: string, codeScript: string, launchArgs: readonly string[], logFile: string, wait: boolean) {
	const env: NodeJS.ProcessEnv = { ...process.env, VSCODE_SKIP_PRELAUNCH: '1' };
	// Host-only configuration, commonly inherited from VS Code's integrated terminal and agent runtimes
	// Preview tracing belongs to this launcher, not independent commands later run in the dev app.
	for (const name of ['ELECTRON_RUN_AS_NODE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'CODE_OSS_DEV_REFS_VOLUMES', 'UV_THREADPOOL_SIZE', 'PREVIEW_HUB_ATTEMPT_ID', 'PREVIEW_HUB_READY_FILE', 'PREVIEW_HUB_LOG_COMMAND']) {
		delete env[name];
	}

	let command = codeScript;
	let args = [...launchArgs];
	if (process.platform === 'win32') {
		const electron = path.join(repo, '.build', 'electron', `${readProduct(repo).nameShort}.exe`);
		if (!existsSync(electron)) {
			throw new Error(`Electron is missing at ${electron}; launch without --skip-prelaunch to download it.`);
		}
		command = electron;
		args = ['.', ...(launchArgs.includes('--extensionTestsPath') ? [] : ['--disable-extension=vscode.vscode-api-tests']), ...launchArgs];
		Object.assign(env, { NODE_ENV: 'development', VSCODE_DEV: '1', VSCODE_CLI: '1', ELECTRON_ENABLE_LOGGING: '1', ELECTRON_ENABLE_STACK_DUMPING: '1' });
	}
	log(`launching: ${command} ${args.join(' ')}`);

	const bounded = !!process.env.PREVIEW_HUB_ATTEMPT_ID && wait;
	const logFd = bounded ? undefined : openSync(logFile, 'a');
	try {
		const child = spawn(command, args, { cwd: repo, env, detached: process.platform !== 'win32' || !wait, stdio: bounded ? ['ignore', 'pipe', 'pipe'] : ['ignore', logFd!, logFd!] });
		if (bounded) { void capturePreviewHubProcessLogs(child, logFile).catch(error => log(`Application log capture failed: ${String(error)}`)); }
		const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
			child.once('exit', (code, signal) => resolve({ code, signal }));
		});
		await new Promise<void>((resolve, reject) => {
			child.once('spawn', resolve);
			child.once('error', reject);
		});
		if (!wait) {
			child.unref();
		}
		return { pid: child.pid!, exited };
	} finally {
		if (logFd !== undefined) { closeSync(logFd); }
	}
}

async function allocatePorts(count: number): Promise<number[]> {
	const servers = Array.from({ length: count }, () => net.createServer());
	try {
		await Promise.all(servers.map(server => new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		})));
		return servers.map(server => (server.address() as net.AddressInfo).port);
	} finally {
		await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
	}
}

function readProduct(repo: string): { nameShort: string; sharedDataFolderName?: string } {
	return JSON.parse(readFileSync(path.join(repo, 'product.json'), 'utf8'));
}

async function writeApplicationLogTails(logFile: string, userDataDir: string): Promise<void> {
	log(`application stdout/stderr: ${logFile}`);
	writeLogTail(logFile);
	try {
		const root = path.join(userDataDir, 'logs');
		const latest = (await fs.readdir(root)).filter(name => /^\d{8}T\d{6}$/.test(name)).sort().at(-1);
		if (!latest) { return; }
		const directory = path.join(root, latest);
		log(`most recent profile logs: ${directory}`);
		writeLogTail(path.join(directory, 'main.log'));
		for (const window of (await fs.readdir(directory)).filter(name => /^window\d+$/.test(name)).slice(-3)) {
			log(`renderer log: ${path.join(directory, window, 'renderer.log')}`);
			writeLogTail(path.join(directory, window, 'renderer.log'));
		}
	} catch { /* The app may have exited before its profile logs were created. */ }
}

function writeLogTail(logFile: string): void {
	try {
		writeStderr(readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-80).join('\n') + '\n');
	} catch {
		// No log yet
	}
}

async function isDirectory(directory: string): Promise<boolean> {
	return fs.stat(directory).then(stat => stat.isDirectory(), () => false);
}

async function readJson<T>(file: string): Promise<T | undefined> {
	try {
		return JSON.parse(await fs.readFile(file, 'utf8'));
	} catch {
		return undefined;
	}
}

try {
	process.exitCode = await main();
} catch (error) {
	if (error instanceof UsageError) {
		writeStderr(`${error.message}\n`);
		process.exitCode = 2;
	} else if (error instanceof UnknownExtensionsError) {
		writeStderr(`Extensions not installed: ${error.unknownIds.join(', ')}\nInstalled: ${error.installedIds.join(', ')}\n`);
		process.exitCode = 2;
	} else {
		log(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
