/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, getWindow } from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';

/** Shared copy affordance for sent messages and individual Pi responses. */
export class PiChatMessageCopy {
	private readonly copiedUntil = new Map<string, number>();

	constructor(private readonly writeText: (text: string) => Promise<void>) { }

	renderButton(parent: HTMLElement, id: string, text: string): HTMLButtonElement {
		const button = append(parent, $('button.pi-chat-copy', { type: 'button', 'aria-label': localize('piChat.copyMessage', "Copy message"), title: localize('piChat.copyMessage', "Copy message") })) as HTMLButtonElement;
		const icon = append(button, $('span.codicon', { 'aria-hidden': 'true' }));
		const status = append(parent, $('span.pi-chat-sr-only', { role: 'status' }));
		const update = () => {
			const copied = (this.copiedUntil.get(id) ?? 0) > Date.now();
			icon.classList.toggle('codicon-copy', !copied);
			icon.classList.toggle('codicon-check', copied);
			button.classList.toggle('pi-chat-copied', copied);
			button.setAttribute('aria-label', copied ? localize('piChat.copiedMessage', "Copied to clipboard") : localize('piChat.copyMessage', "Copy message"));
			button.title = copied ? localize('piChat.copiedMessage', "Copied to clipboard") : localize('piChat.copyMessage', "Copy message");
		};
		update();
		const copy = async () => {
			try {
				await this.writeText(text);
				const until = Date.now() + 1800;
				this.copiedUntil.set(id, until);
				status.textContent = localize('piChat.copiedMessage', "Copied to clipboard");
				update();
				getWindow(button).setTimeout(() => {
					if (this.copiedUntil.get(id) === until) { this.copiedUntil.delete(id); }
					if (button.isConnected) { update(); status.textContent = ''; }
				}, 1800);
			} catch {
				status.textContent = localize('piChat.copyFailed', "Could not copy message");
			}
		};
		button.addEventListener('click', event => { event.stopPropagation(); void copy(); });
		return button;
	}
}
