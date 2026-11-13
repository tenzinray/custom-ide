/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Action } from '../../../../../base/common/actions.js';
import { PreviewHubCaffeineButton } from '../../browser/header/PreviewHubCaffeineButton.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { previewHubApps } from '../../../../../platform/previewHub/common/previewHubApps.js';
import { PreviewHubAppState } from '../../../../../platform/previewHub/common/preview-hub-types.js';
import { PreviewHubAppCard } from '../../browser/body/PreviewHubAppCard.js';
import { PreviewHubHeader } from '../../browser/header/PreviewHubHeader.js';

suite('PreviewHub presentation', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('one Pide Start control displays independent watcher and app states and starts only missing pieces', () => {
		const host = mainWindow.document.createElement('div');
		const calls: string[] = [];
		const app = previewHubApps.find(app => app.id === 'pide')!;
		const card = store.add(new PreviewHubAppCard(host, app, () => calls.push('start'), () => calls.push('stop'), () => {}, path => calls.push(path ?? 'launcher')));
		const state: PreviewHubAppState = { id: app.id, phase: 'running', launcherLog: '/log', components: [{ id: 'watcher', running: true }, { id: 'app', running: false }] };
		card.update(state, false);
		const buttons = host.querySelectorAll<HTMLButtonElement>('.preview-hub-actions button');
		buttons[0].click();
		host.querySelector<HTMLButtonElement>('.preview-hub-logs button')!.click();
		assert.deepStrictEqual({ components: [...host.querySelectorAll('.preview-hub-component')].map(row => row.textContent), start: buttons[0].textContent, startDisabled: buttons[0].disabled, calls }, {
			components: ['WatcherRunning', 'Dev AppStopped'], start: 'Start Missing', startDisabled: false, calls: ['start', 'logs/watch.log'],
		});
		card.update({ ...state, components: state.components.map(component => ({ ...component, running: true })) }, false);
		assert.strictEqual(buttons[0].disabled, true);
	});

	test('pending controls cannot double launch and preview stays disabled until an actual local listener exists', () => {
		const host = mainWindow.document.createElement('div');
		const calls: string[] = [];
		const card = store.add(new PreviewHubAppCard(host, previewHubApps[0], () => calls.push('start'), () => {}, () => calls.push('preview'), () => {}));
		card.update({ id: 'brain-wave', phase: 'starting', launcherLog: '/log', components: [{ id: 'frontend', running: false }] }, true);
		for (const button of host.querySelectorAll<HTMLButtonElement>('.preview-hub-actions button')) { button.click(); }
		assert.deepStrictEqual(calls, []);
	});

	test('titlebar always shows On or Off and updates its pressed and highlighted state', () => {
		const host = mainWindow.document.createElement('div');
		const action = store.add(new Action('caffeine', 'Caffeinate'));
		action.checked = false;
		const button = store.add(new PreviewHubCaffeineButton(action, {}));
		button.render(host);
		const read = () => ({ text: host.textContent, pressed: host.querySelector('[role="button"]')?.getAttribute('aria-pressed'), highlighted: !!host.querySelector('.checked'), coffee: !!host.querySelector('.codicon-coffee') });
		const off = read();
		action.checked = true;
		const on = read();
		action.checked = false;
		assert.deepStrictEqual({ off, on, offAgain: read() }, {
			off: { text: 'Caffeine Off', pressed: 'false', highlighted: false, coffee: true },
			on: { text: 'Caffeine On', pressed: 'true', highlighted: true, coffee: true },
			offAgain: off,
		});
	});

	test('caffeine header reflects actual shared state and battery cutoff without inventing local state', () => {
		const host = mainWindow.document.createElement('div');
		let toggles = 0;
		const header = store.add(new PreviewHubHeader(host, () => toggles++));
		header.update({ enabled: true, batteryPercent: 25 });
		const button = host.querySelector<HTMLButtonElement>('button')!;
		button.click();
		const on = { title: button.textContent, pressed: button.getAttribute('aria-pressed'), status: host.querySelector('[role="status"]')?.textContent };
		header.update({ enabled: false, batteryPercent: 14, reason: 'lowBattery' });
		assert.deepStrictEqual({ on, off: button.textContent, status: host.querySelector('[role="status"]')?.textContent, toggles }, {
			on: { title: 'Uncaffeinate', pressed: 'true', status: 'Display stays awake' }, off: 'Caffeinate', status: 'Off: low battery', toggles: 1,
		});
	});
});
