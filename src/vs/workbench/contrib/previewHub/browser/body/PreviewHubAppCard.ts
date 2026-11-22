/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { previewHubApps } from '../../../../../platform/previewHub/common/previewHubApps.js';
import { PreviewHubAppState } from '../../../../../platform/previewHub/common/preview-hub-types.js';
import { PreviewHubProcesses } from './PreviewHubProcesses.js';

import { PreviewHubStatus } from './PreviewHubStatus.js';

/** Presentation only. The container owns service calls, errors, and editor navigation. */
export class PreviewHubAppCard extends Disposable {
	private readonly element: HTMLElement;
	private readonly phase: PreviewHubStatus;
	private readonly processes: PreviewHubProcesses;
	private readonly components = new Map<string, PreviewHubStatus>();
	private readonly error: HTMLElement;
	private readonly start: HTMLButtonElement;
	private readonly stop: HTMLButtonElement;
	private readonly preview: HTMLButtonElement | undefined;

	constructor(parent: HTMLElement, private readonly app: typeof previewHubApps[number], onStart: () => void, onStop: () => void, onPreview: () => void, onLog: (path?: string) => void) {
		super();
		this.element = append(parent, $('section.preview-hub-app'));
		const heading = append(this.element, $('.preview-hub-app-heading'));
		const title = this.button(append(heading, $('h3')), app.name, () => {
			command.hidden = !command.hidden;
			title.setAttribute('aria-expanded', String(!command.hidden));
		});
		title.classList.add('preview-hub-app-title');
		title.setAttribute('aria-expanded', 'false');
		this.phase = new PreviewHubStatus(heading);
		this.phase.element.classList.add('preview-hub-phase');
		const command = append(this.element, $('code.preview-hub-command', {}, app.command.filter(arg => arg !== '--preview-hub').join(' ')));
		command.hidden = true;
		if (app.components.length > 1) {
			const components = append(this.element, $('.preview-hub-components'));
			for (const component of app.components) {
				const row = append(components, $('.preview-hub-component'));
				append(row, $('span', {}, component.name));
				this.components.set(component.id, new PreviewHubStatus(row));
			}
		}
		const actions = append(this.element, $('.preview-hub-actions'));
		this.start = this.button(actions, localize('previewHub.start', "Start"), onStart);
		this.start.classList.add('preview-hub-start');
		this.stop = this.button(actions, localize('previewHub.stop', "Stop"), onStop);
		this.stop.classList.add('preview-hub-stop');
		if (app.id !== 'lucent') {
			this.preview = this.button(actions, localize('previewHub.openPreview', "Open Preview"), onPreview);
			this.preview.disabled = true;
		}
		this.start.disabled = this.stop.disabled = true;
		this.processes = new PreviewHubProcesses(this.element, app);
		append(this.element, $('hr.preview-hub-log-separator'));
		const logs = append(this.element, $('.preview-hub-logs'));
		for (const log of app.logs) { this.button(logs, log.name, () => onLog(log.path)); }
		this.button(logs, localize('previewHub.launcherLog', "Launcher Log"), () => onLog());
		this.error = append(this.element, $('p.preview-hub-error', { role: 'status' }));
	}

	private button(parent: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
		const button = append(parent, $('button', { type: 'button' }, text)) as HTMLButtonElement;
		this._register(addDisposableListener(button, 'click', onClick));
		return button;
	}

	update(state: PreviewHubAppState, pending: boolean): void {
		this.phase.update(state.phase);
		this.element.dataset.phase = state.phase;
		this.processes.update(state.processes);
		for (const component of state.components) {
			this.components.get(component.id)?.update(component.running ? 'running' : 'stopped');
		}
		const allRunning = state.components.every(component => component.running);
		const anyRunning = state.components.some(component => component.running);
		this.start.disabled = pending || allRunning || state.phase === 'starting' || state.phase === 'stopping';
		this.start.textContent = anyRunning && !allRunning ? localize('previewHub.startMissing', "Start Missing") : localize('previewHub.start', "Start");
		this.stop.disabled = pending || state.phase === 'stopping' || (!anyRunning && (state.phase === 'stopped' || state.phase === 'error'));
		if (this.preview) {
			this.preview.disabled = this.app.id === 'pide' ? false : !state.previewUrl;
		}
		this.error.textContent = state.error ?? '';
	}
}
