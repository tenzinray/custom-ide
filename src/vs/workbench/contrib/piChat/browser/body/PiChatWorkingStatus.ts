/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';

/** A reserved transcript slot: activity changes never move the messages above it. */
export class PiChatWorkingStatus {
	readonly element = $('.pi-chat-working-status', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });

	constructor() {
		this.setState(false, false);
	}

	setState(working: boolean, compacting: boolean): void {
		this.element.classList.toggle('pi-chat-compacting', working && compacting);
		this.element.style.visibility = working ? 'visible' : 'hidden';
		const text = !working ? '' : compacting ? localize('piChat.compacting', "Compacting…") : localize('piChat.working', "Working…");
		if (this.element.textContent !== text) { this.element.textContent = text; }
	}
}
