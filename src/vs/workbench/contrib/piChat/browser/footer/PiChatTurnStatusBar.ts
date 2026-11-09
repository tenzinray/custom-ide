/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, getWindow } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';

function elapsedTime(start: number, now: number): string {
	const seconds = Math.max(0, Math.floor((now - start) / 1000));
	return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Only the turn bar ticks; composer draft and conversation do not rerender each second. */
export class PiChatTurnStatusBar extends Disposable {
	private readonly element: HTMLElement;
	private readonly turnTime: HTMLElement;
	private readonly lastEventTime: HTMLElement;
	private readonly stopButton: HTMLButtonElement;
	private readonly error: HTMLElement;
	private readonly startedAt = Date.now();
	private lastEventAt: number | undefined;
	private readonly timer: number;

	constructor(parent: HTMLElement, private readonly onStop: () => Promise<void>) {
		super();
		this.element = append(parent, $('.pi-chat-turn-status'));
		const status = append(this.element, $('.pi-chat-turn-status-bar'));
		const turn = append(status, $('span', {}, localize('piChat.turn', "Turn ")));
		this.turnTime = append(turn, $('time'));
		const lastEvent = append(status, $('span', {}, localize('piChat.lastEvent', "Last event ")));
		this.lastEventTime = append(lastEvent, $('time'));
		this.stopButton = append(status, $('button.pi-chat-turn-stop', { type: 'button' }, localize('piChat.stopTurn', "Stop Turn"))) as HTMLButtonElement;
		this.error = append(this.element, $('p.pi-chat-turn-error', { role: 'alert' }));
		this.stopButton.addEventListener('click', () => { void this.stop(); });
		this.tick();
		this.timer = getWindow(parent).setInterval(() => this.tick(), 1000);
	}

	recordEvent(): void {
		this.lastEventAt = Date.now();
		this.tick();
	}

	private tick(): void {
		const now = Date.now();
		this.turnTime.textContent = elapsedTime(this.startedAt, now);
		this.lastEventTime.textContent = this.lastEventAt === undefined ? '—' : elapsedTime(this.lastEventAt, now);
	}

	private async stop(): Promise<void> {
		this.stopButton.disabled = true;
		this.stopButton.textContent = localize('piChat.stopping', "Stopping…");
		this.error.textContent = '';
		try { await this.onStop(); }
		catch (error) {
			if (this._store.isDisposed) { return; }
			this.error.textContent = error instanceof Error ? error.message : localize('piChat.stopError', "Could not stop the turn.");
			this.stopButton.disabled = false;
			this.stopButton.textContent = localize('piChat.stopTurn', "Stop Turn");
		}
	}

	override dispose(): void {
		getWindow(this.element).clearInterval(this.timer);
		this.element.remove();
		super.dispose();
	}
}
