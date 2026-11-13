/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { PreviewHubCaffeineState } from '../../../../../platform/previewHub/common/preview-hub-types.js';

/** Compact keep-awake presentation shared with the main header's app-wide state. */
export class PreviewHubHeader extends Disposable {
	private readonly toggle: HTMLButtonElement;
	private readonly status: HTMLElement;

	constructor(parent: HTMLElement, onToggle: () => void) {
		super();
		const header = append(parent, $('header.preview-hub-header'));
		this.toggle = append(header, $('button.preview-hub-caffeine', { type: 'button', 'aria-pressed': 'false' }, localize('previewHub.caffeinate', "Caffeinate"))) as HTMLButtonElement;
		this._register(addDisposableListener(this.toggle, 'click', onToggle));
		this.status = append(header, $('span.preview-hub-note', { role: 'status' }));
	}

	update(state: PreviewHubCaffeineState): void {
		this.toggle.setAttribute('aria-pressed', String(state.enabled));
		this.toggle.textContent = state.enabled ? localize('previewHub.uncaffeinate', "Uncaffeinate") : localize('previewHub.caffeinate', "Caffeinate");
		this.status.textContent = state.enabled
			? localize('previewHub.displayAwake', "Display stays awake")
			: state.reason === 'lowBattery' ? localize('previewHub.batteryOff', "Off: low battery")
				: state.reason === 'batteryUnavailable' ? localize('previewHub.batteryUnknown', "Off: battery unavailable") : localize('previewHub.sleepNormal', "Normal sleep");
	}
}
