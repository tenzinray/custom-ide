/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { ActionViewItem, IActionViewItemOptions } from '../../../../../base/browser/ui/actionbar/actionViewItems.js';
import { IAction } from '../../../../../base/common/actions.js';
import { localize } from '../../../../../nls.js';

/** Persistent text and active styling make keep-awake state visible without hovering. */
export class PreviewHubCaffeineButton extends ActionViewItem {
	constructor(action: IAction, options: IActionViewItemOptions) {
		super(undefined, action, { ...options, icon: false, label: true });
	}

	override render(container: HTMLElement): void {
		container.classList.add('preview-hub-titlebar-caffeine');
		super.render(container);
	}

	protected override updateLabel(): void {
		if (!this.label) { return; }
		clearNode(this.label);
		append(this.label, $('span.codicon.codicon-coffee', { 'aria-hidden': 'true' }));
		append(this.label, $('span.preview-hub-caffeine-label', {}, this.action.checked
			? localize('previewHub.caffeineOn', "Caffeine On")
			: localize('previewHub.caffeineOff', "Caffeine Off")));
	}

	protected override updateChecked(): void {
		super.updateChecked();
		this.updateLabel();
	}
}
