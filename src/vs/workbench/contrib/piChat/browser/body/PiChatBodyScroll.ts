/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';

// Only follow near the bottom so scrolling up yields control quickly.
const bottomDistanceThreshold = 20;

/** Keeps transcript scrolling user-owned while streaming replaces message nodes. */
export class PiChatBodyScroll extends Disposable {
	private readonly button: HTMLButtonElement;
	private following = true;
	private enabled = true;
	private visible = true;
	private hiddenTop = 0;
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
			if (!this.visible) { return; }
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

	/** Editor tabs detach their DOM when hidden; capture before detachment and restore after reattachment. */
	setVisible(visible: boolean): void {
		if (visible === this.visible) { return; }
		if (!visible) {
			this.hiddenTop = this.body.scrollTop;
			this.renderId++;
		}
		this.visible = visible;
		if (visible) { this.afterRender(this.following, this.hiddenTop); }
		else { this.updateButton(); }
	}

	setEnabled(enabled: boolean): void {
		if (this.enabled === enabled) { return; }
		this.enabled = enabled;
		this.reset();
		if (!enabled) { this.body.scrollTop = 0; }
	}

	reset(): void {
		this.renderId++;
		this.following = true;
		this.hiddenTop = 0;
		this.button.hidden = true;
	}

	afterRender(follow: boolean, previousTop: number): void {
		if (!this.enabled || !this.visible) { return; }
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
		this.button.hidden = !this.enabled || !this.visible || this.body.clientHeight === 0 || this.distanceFromBottom() <= bottomDistanceThreshold;
	}
}
