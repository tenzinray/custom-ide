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
import '../../browser/media/previewHub.css';

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

	test('a failed Pide launch keeps retry and surviving-watcher cleanup available', () => {
		const host = mainWindow.document.createElement('div');
		const calls: string[] = [];
		const app = previewHubApps.find(app => app.id === 'pide')!;
		const card = store.add(new PreviewHubAppCard(host, app, () => calls.push('start'), () => calls.push('stop'), () => {}, () => {}));
		card.update({ id: 'pide', phase: 'error', error: 'Build timed out', launcherLog: '/log', components: [{ id: 'watcher', running: true }, { id: 'app', running: false }] }, false);
		const start = host.querySelector<HTMLButtonElement>('.preview-hub-start')!;
		const stop = host.querySelector<HTMLButtonElement>('.preview-hub-stop')!;
		start.click();
		stop.click();
		assert.deepStrictEqual({ start: start.textContent, calls, error: host.querySelector('.preview-hub-error')?.textContent }, {
			start: 'Start Missing', calls: ['start', 'stop'], error: 'Build timed out',
		});
	});

	test('pending controls cannot double launch and preview stays disabled until an actual local listener exists', () => {
		const host = mainWindow.document.createElement('div');
		const calls: string[] = [];
		const card = store.add(new PreviewHubAppCard(host, previewHubApps[0], () => calls.push('start'), () => {}, () => calls.push('preview'), () => {}));
		card.update({ id: 'brain-wave', phase: 'starting', launcherLog: '/log', components: [{ id: 'frontend', running: false }] }, true);
		for (const button of host.querySelectorAll<HTMLButtonElement>('.preview-hub-actions button')) { button.click(); }
		assert.deepStrictEqual(calls, []);
	});

	test('commands stay hidden until the app title is clicked and processes preserve disclosure state', () => {
		const host = mainWindow.document.createElement('div');
		const card = store.add(new PreviewHubAppCard(host, previewHubApps[0], () => {}, () => {}, () => {}, () => {}));
		const command = host.querySelector<HTMLElement>('.preview-hub-command')!;
		const title = host.querySelector<HTMLButtonElement>('.preview-hub-app-title')!;
		const hiddenInitially = command.hidden;
		title.click();
		const shown = !command.hidden && title.getAttribute('aria-expanded') === 'true';
		title.click();
		const state: PreviewHubAppState = {
			id: 'brain-wave', phase: 'running', launcherLog: '/log', components: [{ id: 'frontend', running: true }], previewUrl: 'http://localhost:5173',
			processes: [
				{ pid: 101, componentId: 'frontend', urls: ['http://localhost:5173'] },
				{ pid: 202, componentId: 'frontend', urls: ['http://localhost:5174'] },
			],
		};
		card.update(state, false);
		const details = host.querySelector<HTMLDetailsElement>('.preview-hub-processes')!;
		details.open = true;
		card.update(state, false);
		assert.deepStrictEqual({ hiddenInitially, shown, hiddenAgain: command.hidden, expanded: details.open, count: details.querySelector('summary')?.textContent, processes: [...host.querySelectorAll('.preview-hub-process')].map(row => row.textContent), runningIcon: !!host.querySelector('.preview-hub-phase .codicon-check'), separator: !!host.querySelector('.preview-hub-log-separator') }, {
			hiddenInitially: true, shown: true, hiddenAgain: true, expanded: true, count: 'Processes & Ports (2)',
			processes: ['Frontend / Vite API · PID 101http://localhost:5173', 'Frontend / Vite API · PID 202http://localhost:5174'], runningIcon: true, separator: true,
		});
	});

	test('only multi-component apps show component rows; Pide can open additional windows while running', () => {
		let windows = 0;
		const results = previewHubApps.map(app => {
			const host = mainWindow.document.createElement('div');
			const card = store.add(new PreviewHubAppCard(host, app, () => {}, () => {}, () => { windows++; }, () => {}));
			card.update({ id: app.id, phase: 'running', launcherLog: '/log', components: app.components.map(component => ({ id: component.id, running: true })) }, false);
			const buttons = host.querySelectorAll<HTMLButtonElement>('.preview-hub-actions button');
			if (app.id === 'pide') { buttons[2].click(); buttons[2].click(); }
			return { actions: [...buttons].map(button => button.textContent), rows: host.querySelectorAll('.preview-hub-component').length, hostedNote: host.textContent?.includes('Backend is hosted') };
		});
		assert.deepStrictEqual({ results, windows }, { results: [
			{ actions: ['Start', 'Stop', 'Open Preview'], rows: 0, hostedNote: false },
			{ actions: ['Start', 'Stop'], rows: 0, hostedNote: false },
			{ actions: ['Start', 'Stop', 'Open Preview'], rows: 2, hostedNote: false },
		], windows: 2 });
	});

	test('titlebar stays icon-only and toggles the checked state used to color the cup', () => {
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
			off: { text: '', pressed: 'false', highlighted: false, coffee: true },
			on: { text: '', pressed: 'true', highlighted: true, coffee: true },
			offAgain: off,
		});
	});

	test('icons stay green or neutral, while only enabled Start and Stop receive their action colors', () => {
		const workbench = mainWindow.document.createElement('div');
		workbench.className = 'monaco-workbench';
		workbench.style.setProperty('--vscode-charts-green', '#28a745');
		workbench.style.setProperty('--vscode-descriptionForeground', '#999999');
		workbench.style.setProperty('--vscode-button-secondaryBackground', 'transparent');
		workbench.style.setProperty('--vscode-button-secondaryForeground', '#eeeeee');
		workbench.style.setProperty('--vscode-foreground', '#eeeeee');
		workbench.style.setProperty('--vscode-sideBar-background', '#222222');
		workbench.style.setProperty('--vscode-textLink-foreground', '#3388ff');
		workbench.style.setProperty('--vscode-errorForeground', '#dd3333');
		const titlebar = mainWindow.document.createElement('div');
		titlebar.className = 'part titlebar';
		workbench.append(titlebar);
		const hub = mainWindow.document.createElement('div');
		hub.className = 'preview-hub';
		workbench.append(hub);
		mainWindow.document.body.append(workbench);
		try {
			const action = store.add(new Action('caffeine-colors', 'Caffeinate'));
			action.checked = false;
			const actionItem = mainWindow.document.createElement('div');
			titlebar.append(actionItem);
			store.add(new PreviewHubCaffeineButton(action, {})).render(actionItem);
			const header = store.add(new PreviewHubHeader(hub, () => {}));
			const card = store.add(new PreviewHubAppCard(hub, previewHubApps[2], () => {}, () => {}, () => {}, () => {}));
			const color = (selector: string) => mainWindow.getComputedStyle(workbench.querySelector<HTMLElement>(selector)!).color;
			const off = color('.preview-hub-titlebar-caffeine .codicon-coffee');
			action.checked = true;
			header.update({ enabled: true });
			card.update({ id: 'pide', phase: 'running', components: [{ id: 'watcher', running: true }, { id: 'app', running: true }], launcherLog: '/log' }, false);
			const runningControls = { start: color('.preview-hub-start'), stop: color('.preview-hub-stop') };
			const on = [color('.preview-hub-titlebar-caffeine .codicon-coffee'), color('.preview-hub-caffeine .codicon-coffee'), color('.preview-hub-phase .codicon-check')];
			const runningStatuses = [...hub.querySelectorAll<HTMLElement>('.preview-hub-status')].map(status => ({ text: status.textContent, textColor: mainWindow.getComputedStyle(status.lastElementChild!).color, checkColor: mainWindow.getComputedStyle(status.querySelector('.codicon-check')!).color }));
			card.update({ id: 'pide', phase: 'stopped', components: [{ id: 'watcher', running: false }, { id: 'app', running: false }], launcherLog: '/log' }, false);
			const stoppedControls = { start: color('.preview-hub-start'), stop: color('.preview-hub-stop') };
			const stopped = color('.preview-hub-phase');
			const stoppedStatuses = [...hub.querySelectorAll<HTMLElement>('.preview-hub-status')].map(status => ({ text: status.textContent, color: mainWindow.getComputedStyle(status.lastElementChild!).color, icons: status.querySelectorAll('.codicon').length }));
			workbench.style.removeProperty('--vscode-button-secondaryBackground');
			const fallbackBackgrounds = [...hub.querySelectorAll<HTMLButtonElement>('.preview-hub-actions button')].map(button => mainWindow.getComputedStyle(button).backgroundColor);
			const filledWithoutSecondaryToken = fallbackBackgrounds.every(color => color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent');
			action.checked = false;
			header.update({ enabled: false });
			assert.deepStrictEqual({ off, on, offAgain: color('.preview-hub-titlebar-caffeine .codicon-coffee'), hubOff: color('.preview-hub-caffeine .codicon-coffee'), stopped, runningStatuses, stoppedStatuses, runningControls, stoppedControls, filledWithoutSecondaryToken, scrollbar: mainWindow.getComputedStyle(hub).scrollbarWidth }, {
				off: 'rgb(153, 153, 153)', on: Array(3).fill('rgb(40, 167, 69)'), offAgain: 'rgb(153, 153, 153)', hubOff: 'rgb(153, 153, 153)', stopped: 'rgb(153, 153, 153)', runningStatuses: Array(3).fill({ text: 'Running', textColor: 'rgb(40, 167, 69)', checkColor: 'rgb(40, 167, 69)' }), stoppedStatuses: Array(3).fill({ text: 'Stopped', color: 'rgb(153, 153, 153)', icons: 0 }), runningControls: { start: 'rgb(238, 238, 238)', stop: 'rgb(221, 51, 51)' }, stoppedControls: { start: 'rgb(51, 136, 255)', stop: 'rgb(238, 238, 238)' }, filledWithoutSecondaryToken: true, scrollbar: 'none',
			});
		} finally { workbench.remove(); }
	});

	test('caffeine header reflects actual shared state and battery cutoff without inventing local state', () => {
		const host = mainWindow.document.createElement('div');
		let toggles = 0;
		const header = store.add(new PreviewHubHeader(host, () => toggles++));
		header.update({ enabled: true, batteryPercent: 25 });
		const button = host.querySelector<HTMLButtonElement>('button')!;
		button.click();
		const on = { title: button.textContent, pressed: button.getAttribute('aria-pressed'), coffeeFirst: button.firstElementChild?.classList.contains('codicon-coffee') };
		header.update({ enabled: false, batteryPercent: 14, reason: 'lowBattery' });
		assert.deepStrictEqual({ on, off: button.textContent, status: host.querySelector('[role="status"]'), toggles }, {
			on: { title: 'Uncaffeinate', pressed: 'true', coffeeFirst: true }, off: 'Caffeinate', status: null, toggles: 1,
		});
	});
});
