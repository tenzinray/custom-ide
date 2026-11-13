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

	test('Lucent and Pide never offer a browser preview or simulator launch button', () => {
		const actions = previewHubApps.filter(app => app.id !== 'brain-wave').map(app => {
			const host = mainWindow.document.createElement('div');
			store.add(new PreviewHubAppCard(host, app, () => {}, () => {}, () => { throw new Error('Must not open a preview'); }, () => {}));
			return [...host.querySelectorAll('.preview-hub-actions button')].map(button => button.textContent);
		});
		assert.deepStrictEqual(actions, [['Start', 'Stop'], ['Start', 'Stop']]);
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

	test('actual coffee and check glyphs are green, stopped stays neutral, and buttons share neutral fills', () => {
		const workbench = mainWindow.document.createElement('div');
		workbench.className = 'monaco-workbench';
		workbench.style.setProperty('--vscode-charts-green', '#28a745');
		workbench.style.setProperty('--vscode-descriptionForeground', '#999999');
		workbench.style.setProperty('--vscode-button-secondaryBackground', 'transparent');
		workbench.style.setProperty('--vscode-button-secondaryForeground', '#eeeeee');
		workbench.style.setProperty('--vscode-foreground', '#eeeeee');
		workbench.style.setProperty('--vscode-sideBar-background', '#222222');
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
			const card = store.add(new PreviewHubAppCard(hub, previewHubApps[0], () => {}, () => {}, () => {}, () => {}));
			const color = (selector: string) => mainWindow.getComputedStyle(workbench.querySelector<HTMLElement>(selector)!).color;
			const off = color('.preview-hub-titlebar-caffeine .codicon-coffee');
			action.checked = true;
			header.update({ enabled: true });
			card.update({ id: 'brain-wave', phase: 'running', components: [{ id: 'frontend', running: true }], launcherLog: '/log' }, false);
			const on = [color('.preview-hub-titlebar-caffeine .codicon-coffee'), color('.preview-hub-caffeine .codicon-coffee'), color('.preview-hub-phase .codicon-check')];
			card.update({ id: 'brain-wave', phase: 'stopped', components: [{ id: 'frontend', running: false }], launcherLog: '/log' }, false);
			const stopped = color('.preview-hub-phase');
			const backgrounds = [...hub.querySelectorAll<HTMLButtonElement>('.preview-hub-actions button')].map(button => mainWindow.getComputedStyle(button).backgroundColor);
			const neutralButtons = backgrounds.every(color => color === backgrounds[0] && color !== 'rgba(0, 0, 0, 0)');
			workbench.style.removeProperty('--vscode-button-secondaryBackground');
			const fallbackBackgrounds = [...hub.querySelectorAll<HTMLButtonElement>('.preview-hub-actions button')].map(button => mainWindow.getComputedStyle(button).backgroundColor);
			const filledWithoutSecondaryToken = fallbackBackgrounds.every(color => color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent');
			action.checked = false;
			header.update({ enabled: false });
			assert.deepStrictEqual({ off, on, offAgain: color('.preview-hub-titlebar-caffeine .codicon-coffee'), hubOff: color('.preview-hub-caffeine .codicon-coffee'), stopped, neutralButtons, filledWithoutSecondaryToken }, {
				off: 'rgb(153, 153, 153)', on: Array(3).fill('rgb(40, 167, 69)'), offAgain: 'rgb(153, 153, 153)', hubOff: 'rgb(153, 153, 153)', stopped: 'rgb(153, 153, 153)', neutralButtons: true, filledWithoutSecondaryToken: true,
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
