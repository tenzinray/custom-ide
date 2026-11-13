/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { powerSaveBlocker } from 'electron';
import { IntervalTimer } from '../../../base/common/async.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IProcessEnvironment } from '../../../base/common/platform.js';
import { ILogService } from '../../log/common/log.js';
import { IPreviewHubService, previewHubPollInterval } from '../common/previewHub.js';
import { PreviewHubAppId } from '../common/previewHubApps.js';
import { PreviewHubSnapshot } from '../common/preview-hub-types.js';
import { PreviewHubProcessService } from '../node/PreviewHubProcessService.js';
import { PreviewHubCaffeineService } from './PreviewHubCaffeineService.js';

/** Application-wide coordinator: one process owner and one battery-guarded display assertion. */
export class PreviewHubService extends Disposable implements IPreviewHubService {
	declare readonly _serviceBrand: undefined;
	private readonly changed = this._register(new Emitter<PreviewHubSnapshot>());
	readonly onDidChange = this.changed.event;
	private readonly caffeine = this._register(new PreviewHubCaffeineService(powerSaveBlocker));
	private readonly processes: PreviewHubProcessService;
	private readonly timer = this._register(new IntervalTimer());
	private snapshot: PreviewHubSnapshot = { apps: [], caffeine: { enabled: false } };
	private pending: Promise<PreviewHubSnapshot> | undefined;

	constructor(projects: string, environment: () => Promise<IProcessEnvironment>, @ILogService private readonly log: ILogService) {
		super();
		this.processes = this._register(new PreviewHubProcessService(projects, environment, log));
		// Battery cutoff is checked even when Preview Hub is hidden. No automatic re-enable.
		this.timer.cancelAndSet(() => { void this.getSnapshot(); }, previewHubPollInterval);
	}

	getSnapshot(): Promise<PreviewHubSnapshot> {
		if (!this.pending) {
			this.pending = this.refresh().finally(() => { this.pending = undefined; });
		}
		return this.pending;
	}

	private async refresh(): Promise<PreviewHubSnapshot> {
		await this.caffeine.refresh();
		try {
			this.snapshot = { apps: await this.processes.snapshot(), caffeine: this.caffeine.snapshot };
		} catch (error) {
			this.snapshot = { ...this.snapshot, caffeine: this.caffeine.snapshot, error: error instanceof Error ? error.message : String(error) };
			this.log.error('[Preview Hub] Refresh failed', error);
		}
		if (!this._store.isDisposed) { this.changed.fire(this.snapshot); }
		return this.snapshot;
	}

	async start(id: PreviewHubAppId): Promise<void> {
		try { await this.processes.start(id); } finally { await this.getSnapshot(); }
	}

	async stop(id: PreviewHubAppId): Promise<void> {
		try { await this.processes.stop(id); } finally { await this.getSnapshot(); }
	}

	async openPideWindow(): Promise<void> {
		try { await this.processes.openPideWindow(); } finally { await this.getSnapshot(); }
	}

	async setCaffeine(enabled: boolean): Promise<void> {
		try { await this.caffeine.setEnabled(enabled); }
		finally { await this.getSnapshot(); }
	}
}
