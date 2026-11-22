/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow } from '../../../../../base/browser/dom.js';
import { ActionBar, ActionsOrientation } from '../../../../../base/browser/ui/actionbar/actionbar.js';
import { Action } from '../../../../../base/common/actions.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IContextViewService, IOpenContextView } from '../../../../../platform/contextview/browser/contextView.js';
import { PiChatOpenAIAccounts } from '../../common/pi-chat-openai-account-types.js';
import { PiChatOpenAIAccountMenuItem } from './PiChatOpenAIAccountMenuItem.js';

/** Presentation only: shared account metadata supplies quotas; shared services own authentication/selection. */
export class PiChatOpenAIAccountPicker extends Disposable {
	private readonly button: HTMLButtonElement;
	private readonly label: HTMLElement;
	private readonly menuItems = new Map<string, PiChatOpenAIAccountMenuItem>();
	private state: PiChatOpenAIAccounts | undefined;
	private busy = false;
	private openView: IOpenContextView | undefined;

	constructor(parent: HTMLElement, private readonly onChange: (id?: string) => void, private readonly contextViews: IContextViewService) {
		super();
		const control = append(parent, $('.pi-chat-account-control'));
		this.label = append(control, $('span.pi-chat-account-label', { 'aria-hidden': 'true' }));
		this.button = append(control, $('button.pi-chat-account-picker', { type: 'button', 'aria-label': localize('piChat.account', "ChatGPT Account"), 'aria-haspopup': 'menu', 'aria-expanded': 'false' })) as HTMLButtonElement;
		this._register(addDisposableListener(this.button, 'click', () => this.showMenu()));
		this._register(addDisposableListener(this.button, 'mousedown', event => { if (this.openView) { event.preventDefault(); } }));
		this._register(addDisposableListener(this.button, 'keydown', event => {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); this.showMenu(); }
		}));
		this._register(toDisposable(() => this.openView?.close()));
		this.update(undefined);
	}

	setBusy(busy: boolean): void { this.busy = busy; this.update(this.state); }

	update(state: PiChatOpenAIAccounts | undefined): void {
		this.state = state;
		const active = state?.accounts.find(account => account.id === state.activeId);
		this.label.textContent = active ? active.email.split('@')[0] : state ? localize('piChat.noAccount', "ChatGPT Account") : localize('piChat.loadingAccount', "Loading ChatGPT Account…");
		this.button.setAttribute('aria-label', active ? localize('piChat.selectedAccount', "ChatGPT Account: {0}", active.email) : this.label.textContent);
		this.button.disabled = !!state?.busy || this.busy;
		this.label.classList.toggle('disabled', this.button.disabled);
		if (this.openView) {
			if (this.button.disabled || this.menuItems.size !== (state?.accounts.length ?? 0) || [...this.menuItems.keys()].some(id => !state?.accounts.some(account => account.id === id))) {
				this.openView.close();
			} else {
				for (const account of state?.accounts ?? []) { this.menuItems.get(account.id)?.updateAccount(account); }
			}
		}
	}

	private showMenu(): void {
		if (this.button.disabled) { return; }
		if (this.openView) { this.openView.close(); return; }
		let menu: ActionBar | undefined;
		this.button.setAttribute('aria-expanded', 'true');
		this.openView = this.contextViews.showContextView({
			getAnchor: () => this.button,
			render: container => {
				container.classList.add('pi-chat-account-menu');
				const disposables = new DisposableStore();
				disposables.add(toDisposable(() => container.classList.remove('pi-chat-account-menu')));
				menu = disposables.add(new ActionBar(container, {
					orientation: ActionsOrientation.VERTICAL, ariaRole: 'menu', ariaLabel: localize('piChat.accountsMenu', "ChatGPT Accounts"), focusOnlyEnabledItems: true,
					actionViewItemProvider: (action, options) => {
						const account = this.state?.accounts.find(account => account.id === action.id);
						const item = new PiChatOpenAIAccountMenuItem(action, options, account);
						if (account) { this.menuItems.set(account.id, item); }
						return item;
					},
				}));
				const actions = (this.state?.accounts ?? []).map(account => disposables.add(new Action(account.id, account.email, '', true, () => this.onChange(account.id))));
				if (!actions.length) { actions.push(disposables.add(new Action('piChat.noAccount', this.label.textContent ?? '', '', false))); }
				actions.push(disposables.add(new Action('piChat.addAccount', localize('piChat.addAccount', "Add ChatGPT Account…"), '', true, () => this.onChange(undefined))));
				menu.push(actions, { icon: false, label: true });
				disposables.add(menu.onDidRun(() => { this.openView?.close(); this.button.focus(); }));
				disposables.add(menu.onDidCancel(() => { this.openView?.close(); this.button.focus(); }));
				disposables.add(menu.onDidBlur(() => this.openView?.close()));
				const window = getWindow(container);
				disposables.add(addDisposableListener(window, 'blur', () => this.openView?.close()));
				disposables.add(addDisposableListener(window, 'mousedown', event => {
					if (event.button === 0 && !container.contains(event.target as Node) && !this.button.contains(event.target as Node)) { this.openView?.close(); }
				}));
				return disposables;
			},
			focus: () => {
				const active = this.state?.accounts.findIndex(account => account.id === this.state?.activeId) ?? -1;
				if (active >= 0) { menu?.focus(active); } else { menu?.focus(true); }
			},
			onHide: () => { this.openView = undefined; this.menuItems.clear(); this.button.setAttribute('aria-expanded', 'false'); },
		});
	}
}
