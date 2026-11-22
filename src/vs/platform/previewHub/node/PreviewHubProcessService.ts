/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn, ChildProcess } from 'child_process';
import { appendFile, mkdir, open, realpath } from 'fs/promises';
import { join } from '../../../base/common/path.js';
import { timeout } from '../../../base/common/async.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IProcessEnvironment } from '../../../base/common/platform.js';
import { localize } from '../../../nls.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { ILogService } from '../../log/common/log.js';
import { previewHubApps, PreviewHubAppId } from '../common/previewHubApps.js';
import { previewHubLauncherLogPath } from '../common/previewHub.js';
import { PreviewHubAppState, PreviewHubPideLaunch } from '../common/preview-hub-types.js';
import { getPreviewHubPideWindowArgs, openPreviewHubPideWindow } from './PreviewHubPideWindowService.js';
import { getPreviewHubPideProfile, readPreviewHubPideLaunch } from './PreviewHubPideLaunchService.js';
import { findPreviewHubProcesses, getPreviewHubProcessDetails, getPreviewHubProcessLog, readPreviewHubProcesses, stopPreviewHubProcesses, PreviewHubProcess } from './previewHubProcesses.js';

/** Exact local app processes and launch output. Existing unrelated processes are never blanket-killed. */
export class PreviewHubProcessService extends Disposable {
	private readonly children = new Map<PreviewHubAppId, Set<ChildProcess>>();
	private readonly busy = new Map<PreviewHubAppId, 'starting' | 'stopping'>();
	private readonly errors = new Map<PreviewHubAppId, string>();
	private pideWindowQueue = Promise.resolve();
	private pideWindowRequest = 0;
	private pideWindowGeneration = 0;
	private pideSnapshotDiagnostics: string | undefined;
	private pideProfile: Promise<string> | undefined;
	private pideLaunch: { attemptId: string; path: string; profile: string; generation: number; ready?: PreviewHubPideLaunch } | undefined;

	constructor(private readonly projects: string, private readonly environment: () => Promise<IProcessEnvironment>, private readonly log: ILogService) { super(); }

	private app(id: PreviewHubAppId) {
		const app = previewHubApps.find(app => app.id === id);
		if (!app) { throw new Error(localize('previewHub.unknownApp', "Unknown Preview Hub app.")); }
		return app;
	}

	private async expectedPideProfile(root: string): Promise<string> {
		this.pideProfile ??= this.launchEnvironment().then(env => getPreviewHubPideProfile(root, env)).catch(error => { this.pideProfile = undefined; throw error; });
		return this.pideProfile;
	}

	private hasPideLauncher(): boolean {
		const app = this.app('pide');
		if (app.id !== 'pide') { return false; }
		const watcher = app.watchCommand;
		return [...this.children.get('pide') ?? []].some(child => child.spawnargs.length !== watcher.length || child.spawnargs.some((arg, index) => arg !== watcher[index]));
	}

	private async findProcesses(app: typeof previewHubApps[number], root: string, table: readonly PreviewHubProcess[]) {
		const matches = await findPreviewHubProcesses(app, root, table);
		if (app.id === 'pide') {
			try {
				const profile = await this.expectedPideProfile(root);
				matches.set('app', (matches.get('app') ?? []).filter(entry => {
					try { return getPreviewHubPideWindowArgs(entry.cmd).includes(`--user-data-dir=${profile}`); } catch { return false; }
				}));
			} catch (error) {
				matches.set('app', []);
				this.log.error('[Preview Hub] Could not resolve permanent dev profile', error);
			}
		}
		return matches;
	}

	private async updatePideLaunch(): Promise<void> {
		const attempt = this.pideLaunch;
		if (!attempt || attempt.ready || attempt.generation !== this.pideWindowGeneration || this.errors.has('pide')) { return; }
		try {
			const ready = await readPreviewHubPideLaunch(attempt.path, attempt.attemptId, attempt.profile);
			if (ready) {
				attempt.ready = ready;
				await this.pideLog(`Verified this launch: PID ${ready.pid}, CDP ${ready.cdpPort}, rendered window ${ready.workbench.windowId}, app log ${ready.logFile}`);
			}
		} catch (error) {
			this.errors.set('pide', error instanceof Error ? error.message : String(error));
			await this.pideLog(`Launch verification failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async snapshot(): Promise<PreviewHubAppState[]> {
		const table = await readPreviewHubProcesses();
		return Promise.all(previewHubApps.map(async (app): Promise<PreviewHubAppState> => {
			const root = await realpath(join(this.projects, app.folder)).catch(() => join(this.projects, app.folder));
			const matches = await this.findProcesses(app, root, table);
			if (app.id === 'pide') { await this.updatePideLaunch(); }
			const components = app.components.map(component => ({ id: component.id, running: !!matches.get(component.id)?.length }));
			const active = components.some(component => component.running);
			const processes = await getPreviewHubProcessDetails(app, matches);
			const starting = app.id === 'pide' ? this.hasPideLauncher() && (!this.pideLaunch?.ready || !matches.get('app')?.length) : this.children.has(app.id) && !components.every(component => component.running);
			const running = app.id === 'pide' ? !!matches.get('app')?.length : active;
			const phase = this.busy.get(app.id) ?? (this.errors.has(app.id) ? 'error' : starting ? 'starting' : running ? 'running' : 'stopped');
			if (app.id === 'pide') {
				const diagnostic = JSON.stringify({ phase, components, launcherPids: [...this.children.get(app.id) ?? []].map(child => child.pid), attemptId: this.pideLaunch?.attemptId, pids: processes.map(entry => entry.pid), error: this.errors.get(app.id) });
				if (diagnostic !== this.pideSnapshotDiagnostics) {
					this.pideSnapshotDiagnostics = diagnostic;
					await this.pideLog(`State changed: ${diagnostic}`).catch(error => this.log.error('[Preview Hub] Could not log state', error));
				}
			}
			return {
				id: app.id, components, launcherLog: join(root, previewHubLauncherLogPath),
				watcherLog: await getPreviewHubProcessLog(matches.get('watcher')?.[0]),
				phase,
				error: this.errors.get(app.id), processes,
				previewUrl: app.id === 'brain-wave' ? processes.find(entry => entry.urls.length)?.urls[0] : undefined,
			};
		}));
	}

	async start(id: PreviewHubAppId): Promise<void> {
		if (this.busy.has(id) || (id === 'pide' ? this.hasPideLauncher() : this.children.has(id))) {
			if (id === 'pide') { await this.pideLog(`Start request coalesced with existing operation (phase ${this.busy.get(id) ?? 'launching'}, launcher PIDs ${[...this.children.get(id) ?? []].map(child => child.pid).join(',') || 'pending'})`); }
			return;
		}
		this.busy.set(id, 'starting');
		this.errors.delete(id);
		try {
			const app = this.app(id);
			const root = await realpath(join(this.projects, app.folder));
			const matches = await this.findProcesses(app, root, await readPreviewHubProcesses());
			if (app.components.every(component => matches.get(component.id)?.length)) { return; }
			let command: readonly string[] = app.command;
			if (app.id === 'pide' && matches.get('app')?.length) { command = app.watchCommand; }
			// A watcher alone is not readiness: the normal launcher also waits for its initial build.
			const env = await this.launchEnvironment();
			await mkdir(join(root, 'logs'), { recursive: true });
			const attemptId = id === 'pide' ? generateUuid() : undefined;
			const outputPath = attemptId ? join(root, 'logs', `preview-hub-${attemptId}.log`) : join(root, previewHubLauncherLogPath);
			if (attemptId) {
				env.PREVIEW_HUB_ATTEMPT_ID = attemptId;
				if (command === app.command) {
					this.pideLaunch = { attemptId, path: outputPath, profile: await this.expectedPideProfile(root), generation: this.pideWindowGeneration };
				}
				await this.pideLog(`Attempt ${attemptId}: command=${command.join(' ')}, diagnostic log=${outputPath}`);
			}
			const output = await open(outputPath, 'a');
			try {
				await output.write(`\n[Preview Hub] ${new Date().toISOString()} Starting ${command.join(' ')}; attempt=${attemptId ?? 'none'}\n`);
				await output.write(`[Preview Hub] Host PID ${process.pid}, executable ${process.execPath}, Node ${process.version}; matched processes: ${JSON.stringify([...matches].map(([component, entries]) => ({ component, pids: entries.map(entry => entry.pid) })))}\n`);
				const child = spawn(command[0], command.slice(1), { cwd: root, env, detached: true, stdio: ['ignore', output.fd, output.fd] });
				const children = this.children.get(id) ?? new Set<ChildProcess>();
				children.add(child);
				this.children.set(id, children);
				child.once('exit', (code, signal) => {
					children.delete(child);
					if (!children.size) { this.children.delete(id); }
					if ((code !== 0 || signal) && !this.busy.has(id)) {
						this.errors.set(id, localize('previewHub.exit', "Process exited with code {0} (signal: {1}). Open the launcher log for details.", code ?? 'none', signal ?? 'none'));
					}
					const message = `Process exited: PID ${child.pid}, code ${code}, signal ${signal}, attempt=${attemptId ?? 'none'}`;
					void (id === 'pide' ? this.pideLog(message) : appendFile(outputPath, `[Preview Hub] ${new Date().toISOString()} ${message}\n`))
						.catch(error => this.log.error('[Preview Hub] Could not log process exit', error));
					this.log.info('[Preview Hub] Process exited', { id, code, signal });
				});
				await new Promise<void>((resolve, reject) => {
					child.once('spawn', resolve);
					child.once('error', error => { children.delete(child); if (!children.size) { this.children.delete(id); } reject(error); });
				});
				this.log.info('[Preview Hub] Started', { id, pid: child.pid, command });
			} catch (error) {
				await output.write(`[Preview Hub] Start failed: ${error instanceof Error ? error.message : String(error)}\n`);
				throw error;
			} finally { await output.close(); }
		} catch (error) {
			this.errors.set(id, error instanceof Error ? error.message : String(error));
			if (id === 'pide') {
				await this.pideLog(`Start failed: ${error instanceof Error ? error.message : String(error)}`).catch(logError => this.log.error('[Preview Hub] Could not log start failure', logError));
			}
			this.log.error('[Preview Hub] Start failed', id, error);
			throw error;
		} finally { this.busy.delete(id); }
	}

	private async launchEnvironment(): Promise<IProcessEnvironment> {
		// The shell resolver returns overrides, and intentionally returns {} for CLI launches.
		const env = { ...process.env, ...await this.environment() };
		// Never turn a spawned dev app into Node or pass incomplete indexed Git overrides.
		delete env.ELECTRON_RUN_AS_NODE;
		delete env.GIT_CONFIG_COUNT;
		delete env.GIT_CONFIG_PARAMETERS;
		return env;
	}

	openPideWindow(): Promise<void> {
		const request = ++this.pideWindowRequest;
		const generation = this.pideWindowGeneration;
		void this.pideLog(`Window request ${request} received (host PID ${process.pid})`).catch(error => this.log.error('[Preview Hub] Could not log window request', error));
		const operation = this.pideWindowQueue.then(() => this.openNextPideWindow(request, generation));
		this.pideWindowQueue = operation.catch(() => {});
		return operation;
	}

	private async pideLog(message: string): Promise<void> {
		const root = await realpath(join(this.projects, this.app('pide').folder));
		await mkdir(join(root, 'logs'), { recursive: true });
		const entry = `[Preview Hub] ${new Date().toISOString()} [${this.pideLaunch?.attemptId ?? 'no-attempt'}] ${message}\n`;
		await appendFile(join(root, previewHubLauncherLogPath), entry);
		if (this.pideLaunch) { await appendFile(this.pideLaunch.path, entry); }
		this.log.info('[Preview Hub]', message);
	}

	private checkPideWindowGeneration(generation: number): void {
		if (generation !== this.pideWindowGeneration) {
			throw new Error(localize('previewHub.windowCancelled', "Dev window request cancelled by Stop."));
		}
	}

	private async openNextPideWindow(request: number, generation: number): Promise<void> {
		try {
			this.checkPideWindowGeneration(generation);
			// A click received during Stop waits for that operation, rather than silently disappearing.
			while (this.busy.get('pide') === 'stopping') {
				await timeout(250);
				this.checkPideWindowGeneration(generation);
			}
			const app = this.app('pide');
			const root = await realpath(join(this.projects, app.folder));
			let matches = await this.findProcesses(app, root, await readPreviewHubProcesses());
			let running = matches.get('app')?.[0];
			if (!running || (this.pideLaunch?.generation === generation && !this.pideLaunch.ready)) {
				const alreadyStarting = this.hasPideLauncher() || this.busy.has('pide');
				await this.pideLog(`Window request ${request}: ${alreadyStarting ? 'waiting for the existing launcher' : 'starting the dev app'}`);
				this.checkPideWindowGeneration(generation);
				await this.start('pide');
				const started = Date.now();
				// Outer watchdog: the shell build wait and launcher CDP deadline report their own failures first.
				while (!running || (this.pideLaunch?.generation === generation && !this.pideLaunch.ready)) {
					this.checkPideWindowGeneration(generation);
					const error = this.errors.get('pide');
					if (error) { throw new Error(error); }
					if ((!this.hasPideLauncher() && !this.busy.has('pide')) || Date.now() - started > 8 * 60_000) {
						throw new Error(localize('previewHub.noDevWindow', "The dev launcher did not produce an app process. Open the launcher and watcher logs for details."));
					}
					await timeout(500);
					await this.updatePideLaunch();
					matches = await this.findProcesses(app, root, await readPreviewHubProcesses());
					running = this.pideLaunch?.ready ? matches.get('app')?.find(entry => entry.pid === this.pideLaunch?.ready?.pid) : undefined;
				}
				await this.pideLog(`Window request ${request}: rendered workbench verified, PID ${running.pid}, waited ${Date.now() - started}ms`);
				// A fresh launch supplies this request's first window. Every queued request opens another.
				if (!alreadyStarting) { this.checkPideWindowGeneration(generation); return; }
			}
			this.checkPideWindowGeneration(generation);
			await this.pideLog(`Window request ${request}: forwarding --new-window to dev PID ${running.pid}`);
			await openPreviewHubPideWindow(root, running.cmd, await this.launchEnvironment(), running.pid);
			await this.pideLog(`Window request ${request}: new rendered window verified`);
		} catch (error) {
			await this.pideLog(`Window request ${request} failed: ${error instanceof Error ? error.message : String(error)}`)
				.catch(logError => this.log.error('[Preview Hub] Could not log failed window request', logError));
			throw error;
		}
	}

	async stop(id: PreviewHubAppId): Promise<void> {
		if (this.busy.has(id)) { return; }
		this.busy.set(id, 'stopping');
		if (id === 'pide') { this.pideWindowGeneration++; }
		try {
			if (id === 'pide') { await this.pideLog('Stop requested; cancelling outstanding window requests'); }
			const app = this.app(id);
			const table = await readPreviewHubProcesses();
			const root = await realpath(join(this.projects, app.folder));
			const matches = await this.findProcesses(app, root, table);
			const ownedPids = new Set([...this.children.get(id) ?? []].map(child => child.pid));
			const owned = table.filter(entry => ownedPids.has(entry.pid));
			await stopPreviewHubProcesses([...owned, ...[...matches.values()].flat()], table);
			this.children.delete(id);
			this.errors.delete(id);
			this.log.info('[Preview Hub] Stopped', id);
		} finally { this.busy.delete(id); }
	}

	override dispose(): void {
		this.pideWindowGeneration++;
		// Detached groups are created only for our launches. Never signal discovered external groups on exit.
		for (const children of this.children.values()) {
			for (const child of children) {
				if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ } }
			}
		}
		super.dispose();
	}
}
