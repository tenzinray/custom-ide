/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { PiChatOpenAIAccounts } from '../../common/pi-chat-openai-account-types.js';

/** Presentation only: the shared account service owns authentication and selection. */
export class PiChatOpenAIAccountPicker extends Disposable {
	private readonly select: HTMLSelectElement;
	private readonly label: HTMLElement;
	private state: PiChatOpenAIAccounts | undefined;
	private busy = false;

	constructor(parent: HTMLElement, onChange: (id?: string) => void) {
		super();
		const control = append(parent, $('.pi-chat-account-control'));
		this.label = append(control, $('span.pi-chat-account-label', { 'aria-hidden': 'true' }));
		this.select = append(control, $('select.pi-chat-account-picker', { 'aria-label': localize('piChat.account', "ChatGPT Account") })) as HTMLSelectElement;
		this._register(addDisposableListener(this.select, 'change', () => {
			const id = this.select.value;
			this.select.value = this.state?.activeId ?? '';
			onChange(id || undefined);
		}));
		this.update(undefined);
	}

	setBusy(busy: boolean): void { this.busy = busy; this.update(this.state); }

	update(state: PiChatOpenAIAccounts | undefined): void {
		this.state = state;
		clearNode(this.select);
		if (!state?.activeId) { append(this.select, $('option', { value: '', disabled: true }, state ? localize('piChat.noAccount', "ChatGPT Account") : localize('piChat.loadingAccount', "Loading ChatGPT Account…"))); }
		for (const account of state?.accounts ?? []) { append(this.select, $('option', { value: account.id }, account.email)); }
		append(this.select, $('option', { value: '' }, localize('piChat.addAccount', "Add ChatGPT Account…")));
		this.select.value = state?.activeId ?? '';
		const active = state?.accounts.find(account => account.id === state.activeId);
		this.label.textContent = active ? active.email.split('@')[0] : this.select.selectedOptions[0]?.textContent ?? '';
		this.select.disabled = !!state?.busy || this.busy;
		this.label.classList.toggle('disabled', this.select.disabled);
	}
}
