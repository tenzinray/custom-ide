/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn, ChildProcess } from 'child_process';
import { mkdir, open, realpath } from 'fs/promises';
import { join } from '../../../base/common/path.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IProcessEnvironment } from '../../../base/common/platform.js';
import { localize } from '../../../nls.js';
import { ILogService } from '../../log/common/log.js';
import { previewHubApps, PreviewHubAppId } from '../common/previewHubApps.js';
import { previewHubLauncherLogPath } from '../common/previewHub.js';
import { PreviewHubAppState } from '../common/preview-hub-types.js';
import { findPreviewHubProcesses, getPreviewHubProcessDetails, getPreviewHubProcessLog, readPreviewHubProcesses, stopPreviewHubProcesses } from './previewHubProcesses.js';

/** Exact local app processes and launch output. Existing unrelated processes are never blanket-killed. */
export class PreviewHubProcessService extends Disposable {
	private readonly children = new Map<PreviewHubAppId, ChildProcess>();
	private readonly busy = new Map<PreviewHubAppId, 'starting' | 'stopping'>();
	private readonly errors = new Map<PreviewHubAppId, string>();

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
			return {
				id: app.id, components, launcherLog: join(root, previewHubLauncherLogPath),
				watcherLog: await getPreviewHubProcessLog(matches.get('watcher')?.[0]),
				phase: this.busy.get(app.id) ?? (this.children.has(app.id) && !components.every(component => component.running) ? 'starting' : active ? 'running' : this.errors.has(app.id) ? 'error' : 'stopped'),
				error: this.errors.get(app.id), processes,
				previewUrl: app.id === 'brain-wave' ? processes.find(entry => entry.urls.length)?.urls[0] : undefined,
			};
		}));
	}

	async start(id: PreviewHubAppId): Promise<void> {
		if (this.busy.has(id) || this.children.has(id)) { return; }
		this.busy.set(id, 'starting');
		this.errors.delete(id);
		try {
			const app = this.app(id);
			const root = await realpath(join(this.projects, app.folder));
			const matches = await findPreviewHubProcesses(app, root, await readPreviewHubProcesses());
			if (app.components.every(component => matches.get(component.id)?.length)) { return; }
			let command: readonly string[] = app.command;
			if (app.id === 'pide') {
				if (matches.get('watcher')?.length) { command = app.launchCommand; }
				else if (matches.get('app')?.length) { command = app.watchCommand; }
			}
			const env = { ...await this.environment() };
			// Electron's main-process environment must not turn a spawned dev app into Node.
			delete env.ELECTRON_RUN_AS_NODE;
			delete env.GIT_CONFIG_COUNT;
			delete env.GIT_CONFIG_PARAMETERS;
			await mkdir(join(root, 'logs'), { recursive: true });
			const output = await open(join(root, previewHubLauncherLogPath), 'a');
			try {
				await output.write(`\n[Preview Hub] ${new Date().toISOString()} Starting ${command.join(' ')}\n`);
				const child = spawn(command[0], command.slice(1), { cwd: root, env, detached: true, stdio: ['ignore', output.fd, output.fd] });
				this.children.set(id, child);
				child.once('exit', (code, signal) => {
					if (this.children.get(id) === child) { this.children.delete(id); }
					if (code && !this.busy.has(id)) {
						this.errors.set(id, localize('previewHub.exit', "Process exited with code {0}. Open the launcher log for details.", code));
					}
					this.log.info('[Preview Hub] Process exited', { id, code, signal });
				});
				await new Promise<void>((resolve, reject) => {
					child.once('spawn', resolve);
					child.once('error', error => { this.children.delete(id); reject(error); });
				});
				this.log.info('[Preview Hub] Started', { id, pid: child.pid, command });
			} finally { await output.close(); }
		} catch (error) {
			this.errors.set(id, error instanceof Error ? error.message : String(error));
			this.log.error('[Preview Hub] Start failed', id, error);
			throw error;
		} finally { this.busy.delete(id); }
	}

	async stop(id: PreviewHubAppId): Promise<void> {
		if (this.busy.has(id)) { return; }
		this.busy.set(id, 'stopping');
		try {
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
		// Detached groups are created only for our launches. Never signal discovered external groups on exit.
		for (const child of this.children.values()) {
			if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ } }
		}
		super.dispose();
	}
}
