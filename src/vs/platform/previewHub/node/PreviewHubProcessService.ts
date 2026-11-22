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
import { ILogService } from '../../log/common/log.js';
import { previewHubApps, PreviewHubAppId } from '../common/previewHubApps.js';
import { previewHubLauncherLogPath } from '../common/previewHub.js';
import { PreviewHubAppState } from '../common/preview-hub-types.js';
import { openPreviewHubPideWindow } from './PreviewHubPideWindowService.js';
import { findPreviewHubProcesses, getPreviewHubProcessDetails, getPreviewHubProcessLog, readPreviewHubProcesses, stopPreviewHubProcesses } from './previewHubProcesses.js';

/** Exact local app processes and launch output. Existing unrelated processes are never blanket-killed. */
export class PreviewHubProcessService extends Disposable {
	private readonly children = new Map<PreviewHubAppId, ChildProcess>();
	private readonly busy = new Map<PreviewHubAppId, 'starting' | 'stopping'>();
	private readonly errors = new Map<PreviewHubAppId, string>();
	private pideWindowQueue = Promise.resolve();
	private pideWindowRequest = 0;
	private pideWindowGeneration = 0;
	private pideSnapshotDiagnostics: string | undefined;

	constructor(private readonly projects: string, private readonly environment: () => Promise<IProcessEnvironment>, private readonly log: ILogService) { super(); }

	private app(id: PreviewHubAppId) {
		const app = previewHubApps.find(app => app.id === id);
		if (!app) { throw new Error(localize('previewHub.unknownApp', "Unknown Preview Hub app.")); }
		return app;
	}

	async snapshot(): Promise<PreviewHubAppState[]> {
		const table = await readPreviewHubProcesses();
		return Promise.all(previewHubApps.map(async (app): Promise<PreviewHubAppState> => {
			const root = await realpath(join(this.projects, app.folder)).catch(() => join(this.projects, app.folder));
			const matches = await findPreviewHubProcesses(app, root, table);
			const components = app.components.map(component => ({ id: component.id, running: !!matches.get(component.id)?.length }));
			const active = components.some(component => component.running);
			const processes = await getPreviewHubProcessDetails(app, matches);
			const phase = this.busy.get(app.id) ?? (this.errors.has(app.id) ? 'error' : this.children.has(app.id) && !components.every(component => component.running) ? 'starting' : active ? 'running' : 'stopped');
			if (app.id === 'pide') {
				const diagnostic = JSON.stringify({ phase, components, launcherPid: this.children.get(app.id)?.pid, pids: processes.map(entry => entry.pid), error: this.errors.get(app.id) });
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
		if (this.busy.has(id) || this.children.has(id)) {
			if (id === 'pide') { await this.pideLog(`Start request coalesced with existing operation (phase ${this.busy.get(id) ?? 'launching'}, launcher PID ${this.children.get(id)?.pid ?? 'pending'})`); }
			return;
		}
		this.busy.set(id, 'starting');
		this.errors.delete(id);
		try {
			const app = this.app(id);
			const root = await realpath(join(this.projects, app.folder));
			const matches = await findPreviewHubProcesses(app, root, await readPreviewHubProcesses());
			if (app.components.every(component => matches.get(component.id)?.length)) { return; }
			let command: readonly string[] = app.command;
			if (app.id === 'pide' && matches.get('app')?.length) { command = app.watchCommand; }
			// A watcher alone is not readiness: the normal launcher also waits for its initial build.
			const env = await this.launchEnvironment();
			await mkdir(join(root, 'logs'), { recursive: true });
			const output = await open(join(root, previewHubLauncherLogPath), 'a');
			try {
				await output.write(`\n[Preview Hub] ${new Date().toISOString()} Starting ${command.join(' ')}\n`);
				await output.write(`[Preview Hub] Host PID ${process.pid}, executable ${process.execPath}, Node ${process.version}; matched processes: ${JSON.stringify([...matches].map(([component, entries]) => ({ component, pids: entries.map(entry => entry.pid) })))}\n`);
				const child = spawn(command[0], command.slice(1), { cwd: root, env, detached: true, stdio: ['ignore', output.fd, output.fd] });
				this.children.set(id, child);
				child.once('exit', (code, signal) => {
					if (this.children.get(id) === child) { this.children.delete(id); }
					if ((code !== 0 || signal) && !this.busy.has(id)) {
						this.errors.set(id, localize('previewHub.exit', "Process exited with code {0} (signal: {1}). Open the launcher log for details.", code ?? 'none', signal ?? 'none'));
					}
					void appendFile(join(root, previewHubLauncherLogPath), `[Preview Hub] ${new Date().toISOString()} Process exited: PID ${child.pid}, code ${code}, signal ${signal}\n`)
						.catch(error => this.log.error('[Preview Hub] Could not log process exit', error));
					this.log.info('[Preview Hub] Process exited', { id, code, signal });
				});
				await new Promise<void>((resolve, reject) => {
					child.once('spawn', resolve);
					child.once('error', error => { this.children.delete(id); reject(error); });
				});
				this.log.info('[Preview Hub] Started', { id, pid: child.pid, command });
			} catch (error) {
				await output.write(`[Preview Hub] Start failed: ${error instanceof Error ? error.message : String(error)}\n`);
				throw error;
			} finally { await output.close(); }
		} catch (error) {
			this.errors.set(id, error instanceof Error ? error.message : String(error));
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
		await appendFile(join(root, previewHubLauncherLogPath), `[Preview Hub] ${new Date().toISOString()} ${message}\n`);
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
			let matches = await findPreviewHubProcesses(app, root, await readPreviewHubProcesses());
			let running = matches.get('app')?.[0];
			if (!running) {
				const alreadyStarting = this.children.has('pide') || this.busy.has('pide');
				await this.pideLog(`Window request ${request}: ${alreadyStarting ? 'waiting for the existing launcher' : 'starting the dev app'}`);
				this.checkPideWindowGeneration(generation);
				await this.start('pide');
				const started = Date.now();
				// Outer watchdog: the shell build wait and launcher CDP deadline report their own failures first.
				while (!running) {
					this.checkPideWindowGeneration(generation);
					const error = this.errors.get('pide');
					if (error) { throw new Error(error); }
					if ((!this.children.has('pide') && !this.busy.has('pide')) || Date.now() - started > 7 * 60_000) {
						throw new Error(localize('previewHub.noDevWindow', "The dev launcher did not produce an app process. Open the launcher and watcher logs for details."));
					}
					await timeout(500);
					matches = await findPreviewHubProcesses(app, root, await readPreviewHubProcesses());
					running = matches.get('app')?.[0];
				}
				await this.pideLog(`Window request ${request}: dev app detected, PID ${running.pid}, waited ${Date.now() - started}ms`);
				// A fresh launch supplies this request's first window. Every queued request opens another.
				if (!alreadyStarting) { this.checkPideWindowGeneration(generation); return; }
			}
			this.checkPideWindowGeneration(generation);
			await this.pideLog(`Window request ${request}: forwarding --new-window to dev PID ${running.pid}`);
			await openPreviewHubPideWindow(root, running.cmd, await this.launchEnvironment());
			await this.pideLog(`Window request ${request}: --new-window command completed successfully`);
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
			const matches = await findPreviewHubProcesses(app, root, table);
			const child = this.children.get(id);
			const owned = table.filter(entry => entry.pid === child?.pid);
			await stopPreviewHubProcesses([...owned, ...[...matches.values()].flat()], table);
			this.children.delete(id);
			this.errors.delete(id);
			this.log.info('[Preview Hub] Stopped', id);
		} finally { this.busy.delete(id); }
	}

	override dispose(): void {
		this.pideWindowGeneration++;
		// Detached groups are created only for our launches. Never signal discovered external groups on exit.
		for (const child of this.children.values()) {
			if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ } }
		}
		super.dispose();
	}
}
