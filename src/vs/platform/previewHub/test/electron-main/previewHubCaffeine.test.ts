/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { PreviewHubCaffeineService, parsePreviewHubBattery } from '../../electron-main/PreviewHubCaffeineService.js';

suite('PreviewHubCaffeine', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('reads actual percentages and rejects missing or invalid battery data', () => {
		assert.deepStrictEqual([
			parsePreviewHubBattery(`Now drawing from 'Battery Power'\n -InternalBattery-0 23%; discharging`),
			parsePreviewHubBattery(`Now drawing from 'AC Power'\n -InternalBattery-0 14%; charging`),
			parsePreviewHubBattery(`Now drawing from 'AC Power'`),
		], [{ percent: 23, onBattery: true }, { percent: 14, onBattery: false }, { percent: undefined, onBattery: false }]);
		for (const output of ['', `Now drawing from 'Battery Power'`, `Now drawing from 'Battery Power'\n 200%;`]) { assert.throws(() => parsePreviewHubBattery(output)); }
	});

	test('keeps the display awake on battery, stops below 15%, and never automatically restarts', async () => {
		const calls: string[] = [];
		const active = new Set<number>();
		let percent = 15;
		const service = store.add(new PreviewHubCaffeineService({
			start: type => { calls.push(type); active.add(7); return 7; },
			stop: id => { calls.push(`stop:${id}`); return active.delete(id); },
			isStarted: id => active.has(id),
		}, async () => ({ percent, onBattery: true })));
		await service.setEnabled(true);
		await service.setEnabled(true);
		const atCutoff = service.snapshot;
		percent = 14;
		await service.refresh();
		const below = service.snapshot;
		await assert.rejects(() => service.setEnabled(true));
		percent = 50;
		await service.refresh();
		assert.deepStrictEqual({ atCutoff, below, recovered: service.snapshot, calls }, {
			atCutoff: { enabled: true, batteryPercent: 15, reason: undefined },
			below: { enabled: false, batteryPercent: 14, reason: 'lowBattery' },
			recovered: { enabled: false, batteryPercent: 50, reason: undefined },
			calls: ['prevent-display-sleep', 'stop:7'],
		});
	});

	test('battery check failure releases only the owned assertion and blocks enabling', async () => {
		const stopped: number[] = [];
		let failure = false;
		const service = store.add(new PreviewHubCaffeineService({ start: () => 9, stop: id => { stopped.push(id); return true; }, isStarted: () => true }, async () => {
			if (failure) { throw new Error('pmset unavailable'); }
			return { percent: 90, onBattery: true };
		}));
		await service.setEnabled(true);
		failure = true;
		await service.refresh();
		await assert.rejects(() => service.setEnabled(true));
		assert.deepStrictEqual({ state: service.snapshot, stopped }, { state: { enabled: false, batteryPercent: 90, reason: 'batteryUnavailable' }, stopped: [9] });
	});

	test('manual off and disposal release the display assertion, and low charging battery is allowed', async () => {
		const stopped: number[] = [];
		const service = store.add(new PreviewHubCaffeineService({ start: () => 3, stop: id => { stopped.push(id); return true; }, isStarted: () => true }, async () => ({ percent: 8, onBattery: false })));
		await service.setEnabled(true);
		await service.setEnabled(false);
		const off = service.snapshot.enabled;
		await service.setEnabled(true);
		service.dispose();
		assert.deepStrictEqual({ off, stopped }, { off: false, stopped: [3, 3] });
	});
});
