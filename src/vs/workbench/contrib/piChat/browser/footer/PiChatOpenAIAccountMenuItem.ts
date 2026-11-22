/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { ActionViewItem, IActionViewItemOptions } from '../../../../../base/browser/ui/actionbar/actionViewItems.js';
import { IAction } from '../../../../../base/common/actions.js';
import { localize } from '../../../../../nls.js';
import { PiChatOpenAIAccount } from '../../common/pi-chat-openai-account-types.js';
import { getOpenAIAccountUsage } from '../openAIAccountUsage.js';
import { formatOpenAILimitReset } from '../openAILimitReset.js';

/** Account-row presentation only; quota fetching and blocking-window selection live elsewhere. */
export class PiChatOpenAIAccountMenuItem extends ActionViewItem {
	private status: HTMLElement | undefined;

	constructor(action: IAction, options: IActionViewItemOptions, private account?: PiChatOpenAIAccount) {
		// ActionViewItem handles clicks; the lower-level isMenu mode expects Menu's separate mouse-up handler.
		super(undefined, action, { ...options, icon: false, label: true });
	}

	override render(container: HTMLElement): void {
		super.render(container);
		this.label?.setAttribute('role', 'menuitem');
		if (!this.account) { return; }
		container.classList.add('pi-chat-account-menu-row');
		this.status = append(container, $('span.pi-chat-account-usage', { 'aria-hidden': 'true' }));
		this.updateAccount(this.account);
	}

	updateAccount(account: PiChatOpenAIAccount): void {
		this.account = account;
		this.action.label = account.email;
		if (!this.status) { return; }
		const usage = getOpenAIAccountUsage(account.limits);
		this.status.className = `pi-chat-account-usage pi-chat-account-usage-${usage.kind}`;
		this.status.textContent = '';
		let description: string;
		if (usage.kind === 'available') {
			this.status.classList.add('codicon', 'codicon-check');
			description = localize('piChat.accountUsageAvailable', "Usage available");
		} else if (usage.kind === 'blocked') {
			const remaining = formatOpenAILimitReset(usage.resetsAt);
			this.status.textContent = remaining;
			description = localize('piChat.accountUsageReset', "Available in {0}", remaining);
		} else {
			this.status.textContent = '—';
			description = localize('piChat.accountUsageUnknown', "Usage unavailable");
		}
		this.label?.setAttribute('aria-label', localize('piChat.accountUsageLabel', "{0}, {1}", account.email, description));
	}
}
