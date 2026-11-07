/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, getWindow } from '../../../../../base/browser/dom.js';
import { onUnexpectedError } from '../../../../../base/common/errors.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import type { PiChatPlaybackStatus } from '../../common/pi-chat-playback-types.js';

const formatTime = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** Updates only the active response while the extension generates or plays its audio. */
export class PiChatListenPlayback extends Disposable {
	private readonly playbackId = generateUuid();
	private readonly label: HTMLElement;
	private readonly progress: HTMLElement;
	private readonly fill: HTMLElement;
	private readonly time: HTMLElement;
	private timer: number | undefined;
	private phase: PiChatPlaybackStatus['phase'] = 'idle';

	constructor(readonly button: HTMLButtonElement, private readonly response: HTMLElement, private readonly commands: ICommandService, private readonly text: string) {
		super();
		this.label = button.lastElementChild as HTMLElement;
		this.progress = append(response, $('.pi-chat-playback-row'));
		const track = append(this.progress, $('.pi-chat-playback-track'));
		this.fill = append(track, $('.pi-chat-playback-fill'));
		this.time = append(this.progress, $('span.pi-chat-playback-time'));
		this.progress.hidden = true;
		this.onClick();
	}

	onClick(): void {
		if (this.phase === 'generating') { return; }
		if (this.phase === 'playing' || this.phase === 'paused') {
			const command = this.phase === 'playing' ? 'piChat.pause' : 'piChat.resume';
			void this.commands.executeCommand<PiChatPlaybackStatus>(command, this.playbackId).then(status => {
				if (status) { this.update(status); this.schedulePoll(); }
			}, onUnexpectedError);
			return;
		}
		this.update({ phase: 'generating', playbackId: this.playbackId });
		void this.commands.executeCommand<PiChatPlaybackStatus>('piChat.listen', this.text, this.playbackId).then(status => {
			if (this._store.isDisposed) { return; }
			if (!status) { this.update({ phase: 'idle' }); return; }
			this.update(status);
			this.schedulePoll();
		}, error => { this.update({ phase: 'idle' }); onUnexpectedError(error); });
	}

	private schedulePoll(): void {
		if (this._store.isDisposed || this.phase === 'idle') { return; }
		if (this.timer !== undefined) { getWindow(this.button).clearTimeout(this.timer); }
		this.timer = getWindow(this.button).setTimeout(() => {
			this.timer = undefined;
			void this.commands.executeCommand<PiChatPlaybackStatus>('piChat.playbackStatus').then(status => {
				if (status) { this.update(status); }
				this.schedulePoll();
			}, error => { onUnexpectedError(error); this.update({ phase: 'idle' }); });
		}, this.phase === 'paused' ? 1000 : 200);
	}

	private update(status: PiChatPlaybackStatus): void {
		if (this._store.isDisposed) { return; }
		this.phase = status.playbackId === this.playbackId ? status.phase : 'idle';
		this.response.classList.toggle('pi-chat-speaking', this.phase !== 'idle');
		this.button.setAttribute('aria-pressed', String(this.phase === 'playing'));
		this.label.textContent = this.phase === 'generating' ? 'Generating…' : this.phase === 'playing' ? 'Pause' : this.phase === 'paused' ? 'Resume' : 'Listen';
		this.progress.hidden = this.phase === 'idle';
		this.progress.classList.toggle('pi-chat-playback-generating', this.phase === 'generating');
		const position = status.positionMs ?? 0;
		const duration = status.durationMs ?? 0;
		this.fill.style.width = duration ? `${Math.min(100, position / duration * 100)}%` : '0%';
		this.time.textContent = this.phase === 'generating' ? 'Preparing audio…' : duration ? `${this.phase === 'paused' ? 'Paused' : 'Playing'} · ${formatTime(position)} / ${formatTime(duration)}` : this.phase === 'idle' ? '' : this.phase === 'paused' ? 'Paused' : 'Playing';
		if (this.phase === 'idle' && this.timer !== undefined) {
			getWindow(this.button).clearTimeout(this.timer);
			this.timer = undefined;
		}
	}

	override dispose(): void {
		if (this.timer !== undefined) { getWindow(this.button).clearTimeout(this.timer); }
		if (this.phase !== 'idle') { void this.commands.executeCommand('piChat.stop', this.playbackId).catch(onUnexpectedError); }
		this.response.classList.remove('pi-chat-speaking');
		this.progress.remove();
		super.dispose();
	}
}
