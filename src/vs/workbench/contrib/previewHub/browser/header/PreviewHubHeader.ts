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
	private readonly label: HTMLElement;

	constructor(parent: HTMLElement, onToggle: () => void) {
		super();
		const header = append(parent, $('header.preview-hub-header'));
		this.toggle = append(header, $('button.preview-hub-caffeine', { type: 'button', 'aria-pressed': 'false' })) as HTMLButtonElement;
		append(this.toggle, $('span.codicon.codicon-coffee', { 'aria-hidden': 'true' }));
		this.label = append(this.toggle, $('span', {}, localize('previewHub.caffeinate', "Caffeinate")));
		this._register(addDisposableListener(this.toggle, 'click', onToggle));
	}

	update(state: PreviewHubCaffeineState): void {
		this.toggle.setAttribute('aria-pressed', String(state.enabled));
		this.label.textContent = state.enabled ? localize('previewHub.uncaffeinate', "Uncaffeinate") : localize('previewHub.caffeinate', "Caffeinate");
	}
}
