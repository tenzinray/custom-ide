/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { PreviewHubPhase } from '../../../../../platform/previewHub/common/preview-hub-types.js';

/** One status presentation for app headings and individual components. */
export class PreviewHubStatus {
	readonly element: HTMLElement;
	private readonly icon: HTMLElement;
	private readonly text: HTMLElement;

	constructor(parent: HTMLElement) {
		this.element = append(parent, $('span.preview-hub-status', { role: 'status' }));
		this.icon = append(this.element, $('span.codicon.codicon-circle-outline', { 'aria-hidden': 'true' }));
		this.text = append(this.element, $('span', {}, localize('previewHub.checking', "Checking…")));
	}

	update(phase: PreviewHubPhase): void {
		this.element.dataset.phase = phase;
		switch (phase) {
			case 'running': this.set('check', localize('previewHub.running', "Running")); break;
			case 'stopped': this.set(undefined, localize('previewHub.stopped', "Stopped")); break;
			case 'starting': this.set('loading', localize('previewHub.starting', "Starting…")); break;
			case 'stopping': this.set('loading', localize('previewHub.stopping', "Stopping…")); break;
			case 'error': this.set('error', localize('previewHub.failed', "Failed")); break;
		}
	}

	private set(icon: string | undefined, text: string): void {
		this.icon.hidden = icon === undefined;
		this.icon.className = icon ? `codicon codicon-${icon}` : '';
		this.text.textContent = text;
	}
}
