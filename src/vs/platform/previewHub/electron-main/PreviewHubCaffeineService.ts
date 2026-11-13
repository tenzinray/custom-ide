/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { powerSaveBlocker } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Disposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { PreviewHubCaffeineState } from '../common/preview-hub-types.js';

import { previewHubBatteryCutoff } from '../common/previewHub.js';
const exec = promisify(execFile);

/** Read macOS's reported percentage, never estimate battery from remaining runtime. */
export function parsePreviewHubBattery(output: string): { percent?: number; onBattery: boolean } {
	const onBattery = output.includes(`'Battery Power'`);
	const match = /(?<percent>\d+)%;/.exec(output);
	const percent = match?.groups ? Number(match.groups.percent) : undefined;
	if ((!output.includes(`'AC Power'`) && !onBattery) || (onBattery && percent === undefined) || (percent !== undefined && percent > 100)) {
		throw new Error(localize('previewHub.batteryUnreadable', "Could not read the battery level. Caffeinate is off for safety."));
	}
	return { percent, onBattery };
}

async function readBattery() {
	const { stdout } = await exec('/usr/bin/pmset', ['-g', 'batt'], { timeout: 5000 });
	return parsePreviewHubBattery(stdout);
}

/** Owns only our display-sleep assertion; never kills or releases another app's assertions. */
export class PreviewHubCaffeineService extends Disposable {
	private assertion: number | undefined;
	private state: PreviewHubCaffeineState = { enabled: false };

	constructor(
		private readonly blocker: Pick<typeof powerSaveBlocker, 'start' | 'stop' | 'isStarted'>,
		private readonly battery = readBattery,
	) { super(); }

	get snapshot(): PreviewHubCaffeineState { return this.state; }

	async setEnabled(enabled: boolean): Promise<void> {
		if (!enabled) { this.release(); this.state = { ...this.state, reason: undefined }; return; }
		await this.refresh();
		if (this.state.reason) {
			throw new Error(this.state.reason === 'lowBattery'
				? localize('previewHub.lowBattery', "Caffeinate is off because the battery is below {0}%.", previewHubBatteryCutoff)
				: localize('previewHub.batteryUnknown', "Cannot enable caffeinate without a battery safety check."));
		}
		if (this.assertion === undefined) { this.assertion = this.blocker.start('prevent-display-sleep'); }
		this.state = { ...this.state, enabled: this.blocker.isStarted(this.assertion) };
	}

	async refresh(): Promise<void> {
		try {
			const battery = await this.battery();
			const low = battery.onBattery && battery.percent !== undefined && battery.percent < previewHubBatteryCutoff;
			if (low) { this.release(); }
			this.state = { enabled: this.assertion !== undefined && this.blocker.isStarted(this.assertion), batteryPercent: battery.percent, reason: low ? 'lowBattery' : undefined };
		} catch {
			this.release();
			this.state = { ...this.state, reason: 'batteryUnavailable' };
		}
	}

	private release(): void {
		if (this.assertion !== undefined) { this.blocker.stop(this.assertion); this.assertion = undefined; }
		this.state = { ...this.state, enabled: false };
	}

	override dispose(): void { this.release(); super.dispose(); }
}
