/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';

// Match Cody's distance before showing its scroll-to-bottom control.
const bottomDistanceThreshold = 150;

/** Keeps transcript scrolling user-owned while streaming replaces message nodes. */
export class PiChatBodyScroll extends Disposable {
	private readonly button: HTMLButtonElement;
	private following = true;
	private enabled = true;
	private renderId = 0;

	constructor(shell: HTMLElement, private readonly body: HTMLElement) {
		super();
		this.button = append(shell, $('button.pi-chat-scroll-to-bottom', {
			type: 'button',
			'aria-label': localize('piChat.scrollToBottom', "Scroll to latest message"),
			title: localize('piChat.scrollToBottom', "Scroll to latest message")
		})) as HTMLButtonElement;
		append(this.button, $('span.codicon.codicon-arrow-down', { 'aria-hidden': 'true' }));
		this.button.hidden = true;
		this._register(addDisposableListener(body, 'scroll', () => {
			this.following = this.distanceFromBottom() <= bottomDistanceThreshold;
			this.updateButton();
		}));
		this._register(addDisposableListener(this.button, 'click', () => {
			this.following = true;
			this.body.scrollTop = this.body.scrollHeight;
			this.updateButton();
		}));
	}

	get shouldFollow(): boolean { return this.following; }

	setEnabled(enabled: boolean): void {
		if (this.enabled === enabled) { return; }
		this.enabled = enabled;
		this.reset();
		if (!enabled) { this.body.scrollTop = 0; }
	}

	reset(): void {
		this.renderId++;
		this.following = true;
		this.button.hidden = true;
	}

	afterRender(follow: boolean, previousTop: number): void {
		if (!this.enabled) { return; }
		const renderId = ++this.renderId;
		this.body.scrollTop = follow ? this.body.scrollHeight : previousTop;
		this.updateButton();
		if (follow) {
			getWindow(this.body).requestAnimationFrame(() => {
				if (renderId !== this.renderId || !this.following) { return; }
				this.body.scrollTop = this.body.scrollHeight;
				this.updateButton();
			});
		}
	}

	private distanceFromBottom(): number {
		return Math.max(0, this.body.scrollHeight - this.body.scrollTop - this.body.clientHeight);
	}

	private updateButton(): void {
		this.button.hidden = !this.enabled || this.body.clientHeight === 0 || this.distanceFromBottom() <= bottomDistanceThreshold;
	}
}
