/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { previewHubApps } from '../../../../../platform/previewHub/common/previewHubApps.js';
import { PreviewHubAppState, PreviewHubPhase } from '../../../../../platform/previewHub/common/preview-hub-types.js';
import { PreviewHubProcesses } from './PreviewHubProcesses.js';

function phaseLabel(phase: PreviewHubPhase): string {
	switch (phase) {
		case 'running': return localize('previewHub.running', "Running");
		case 'starting': return localize('previewHub.starting', "Starting…");
		case 'stopping': return localize('previewHub.stopping', "Stopping…");
		case 'error': return localize('previewHub.failed', "Failed");
		case 'stopped': return localize('previewHub.stopped', "Stopped");
	}
}

/** Presentation only. The container owns service calls, errors, and editor navigation. */
export class PreviewHubAppCard extends Disposable {
	private readonly element: HTMLElement;
	private readonly phase: HTMLElement;
	private readonly phaseIcon: HTMLElement;
	private readonly phaseText: HTMLElement;
	private readonly processes: PreviewHubProcesses;
	private readonly components = new Map<string, HTMLElement>();
	private readonly error: HTMLElement;
	private readonly start: HTMLButtonElement;
	private readonly stop: HTMLButtonElement;
	private readonly preview: HTMLButtonElement | undefined;

	constructor(parent: HTMLElement, app: typeof previewHubApps[number], onStart: () => void, onStop: () => void, onPreview: () => void, onLog: (path?: string) => void) {
		super();
		this.element = append(parent, $('section.preview-hub-app'));
		const heading = append(this.element, $('.preview-hub-app-heading'));
		const title = this.button(append(heading, $('h3')), app.name, () => {
			command.hidden = !command.hidden;
			title.setAttribute('aria-expanded', String(!command.hidden));
		});
		title.classList.add('preview-hub-app-title');
		title.setAttribute('aria-expanded', 'false');
		this.phase = append(heading, $('span.preview-hub-phase', { role: 'status' }));
		this.phaseIcon = append(this.phase, $('span.codicon.codicon-circle-outline', { 'aria-hidden': 'true' }));
		this.phaseText = append(this.phase, $('span', {}, localize('previewHub.checking', "Checking…")));
		const command = append(this.element, $('code.preview-hub-command', {}, app.command.filter(arg => arg !== '--preview-hub').join(' ')));
		command.hidden = true;
		const components = append(this.element, $('.preview-hub-components'));
		for (const component of app.components) {
			const row = append(components, $('.preview-hub-component'));
			append(row, $('span', {}, component.name));
			this.components.set(component.id, append(row, $('span', {}, '—')));
		}
		if (app.id === 'lucent') { append(this.element, $('p.preview-hub-note', {}, localize('previewHub.hostedBackend', "Backend is hosted; no local backend is started."))); }
		const actions = append(this.element, $('.preview-hub-actions'));
		this.start = this.button(actions, localize('previewHub.start', "Start"), onStart);
		this.start.classList.add('preview-hub-start');
		this.stop = this.button(actions, localize('previewHub.stop', "Stop"), onStop);
		this.stop.classList.add('preview-hub-stop');
		if (app.id === 'brain-wave') {
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
		this.phaseText.textContent = phaseLabel(state.phase);
		const icon = state.phase === 'running' ? 'check' : state.phase === 'error' ? 'error' : state.phase === 'starting' || state.phase === 'stopping' ? 'loading' : 'debug-stop';
		this.phaseIcon.className = `codicon codicon-${icon}`;
		this.element.dataset.phase = state.phase;
		this.processes.update(state.processes);
		for (const component of state.components) {
			const label = this.components.get(component.id);
			if (label) {
				label.textContent = component.running ? localize('previewHub.running', "Running") : localize('previewHub.stopped', "Stopped");
				label.classList.toggle('running', component.running);
			}
		}
		const allRunning = state.components.every(component => component.running);
		this.start.disabled = pending || allRunning || state.phase === 'starting' || state.phase === 'stopping';
		this.start.textContent = state.components.some(component => component.running) && !allRunning ? localize('previewHub.startMissing', "Start Missing") : localize('previewHub.start', "Start");
		this.stop.disabled = pending || state.phase === 'stopped' || state.phase === 'error' || state.phase === 'stopping';
		if (this.preview) { this.preview.disabled = !state.previewUrl; }
		this.error.textContent = state.error ?? '';
	}
}
