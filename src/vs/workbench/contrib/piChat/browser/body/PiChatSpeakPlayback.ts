/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../../base/browser/dom.js';
import { IntervalTimer } from '../../../../../base/common/async.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { PiChatPlaybackStatus, PiChatSpeakRequest } from '../../common/pi-chat-playback-types.js';

interface SpeakRow {
	readonly request: PiChatSpeakRequest;
	phase: PiChatPlaybackStatus['phase'];
	checked: boolean;
	readonly listeners: Set<(phase: PiChatPlaybackStatus['phase']) => void>;
	retryUntil: number;
}

/** Retained per chat: streaming may replace nodes, but must not stop or restart the original speech. */
export class PiChatSpeakPlayback extends Disposable {
	private readonly rows = new Map<string, SpeakRow>();
	private readonly timer = this._register(new IntervalTimer());
	private polling = false;

	constructor(private readonly commands: ICommandService, private readonly notifications: INotificationService) {
		super();
	}

	connect(root: HTMLElement, disposables: DisposableStore): void {
		const fresh: SpeakRow[] = [];
		// Tool rendering owns these explicit speech markers; never infer actions from prose.
		// eslint-disable-next-line no-restricted-syntax
		for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-pi-speak-text]')) {
			const id = button.dataset.piSpeakId!;
			let entry = this.rows.get(id);
			if (!entry) {
				entry = { request: { id, text: button.dataset.piSpeakText! }, phase: 'idle', checked: false, listeners: new Set(), retryUntil: button.dataset.piSpeakLive === 'true' ? Date.now() + 5000 : 0 };
				this.rows.set(id, entry);
				fresh.push(entry);
			}
			const row = entry;
			const update = (phase: PiChatPlaybackStatus['phase']) => {
				const playing = phase === 'playing';
				button.classList.toggle('pi-chat-speak-playing', playing);
				button.firstElementChild!.className = `codicon codicon-${playing ? 'debug-pause' : 'unmute'}`;
				button.setAttribute('aria-pressed', String(playing));
				const label = playing ? localize('piChat.pauseSpeech', "Pause speech") : phase === 'paused' ? localize('piChat.resumeSpeech', "Resume speech") : phase === 'generating' ? localize('piChat.preparingSpeech', "Preparing speech…") : localize('piChat.replaySpeech', "Replay speech");
				button.setAttribute('aria-label', label);
				button.title = label;
				button.disabled = phase === 'generating';
			};
			row.listeners.add(update);
			disposables.add(toDisposable(() => row.listeners.delete(update)));
			update(row.phase);
			disposables.add(addDisposableListener(button, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				void this.commands.executeCommand<PiChatPlaybackStatus>('piChat.toggleSpeak', row.request).then(status => {
					if (status) { this.apply(row, status.phase); this.schedule(); }
				}, error => this.notifications.error(error));
			}));
		}
		if (fresh.length) { void this.refresh(fresh); }
		this.schedule();
		// Bound retained history without evicting controls still displayed in a render.
		if (this.rows.size > 500) { for (const [id, entry] of this.rows) { if (!entry.listeners.size) { this.rows.delete(id); } } }
	}

	private apply(row: SpeakRow, phase: PiChatPlaybackStatus['phase']): void {
		row.phase = phase;
		row.checked = true;
		if (phase !== 'idle') { row.retryUntil = 0; }
		for (const update of row.listeners) { update(phase); }
	}

	private async refresh(rows: readonly SpeakRow[]): Promise<void> {
		if (this.polling || this._store.isDisposed) { return; }
		this.polling = true;
		try {
			const statuses = await this.commands.executeCommand<PiChatPlaybackStatus[]>('piChat.speakStatuses', rows.map(row => row.request));
			if (this._store.isDisposed) { return; }
			for (const status of statuses ?? []) {
				const row = status.playbackId ? this.rows.get(status.playbackId) : undefined;
				if (row) { this.apply(row, status.phase); }
			}
		} catch (error) {
			for (const row of rows) { row.retryUntil = 0; this.apply(row, 'idle'); }
			this.notifications.error(error);
		} finally { this.polling = false; this.schedule(); }
	}

	private schedule(): void {
		if (this._store.isDisposed) { return; }
		this.timer.cancel();
		if ([...this.rows.values()].some(row => row.listeners.size && (!row.checked || row.phase !== 'idle' || row.retryUntil > Date.now()))) {
			this.timer.cancelAndSet(() => {
				const active = [...this.rows.values()].filter(row => row.listeners.size && (!row.checked || row.phase !== 'idle' || row.retryUntil > Date.now()));
				if (active.length) { void this.refresh(active); } else { this.timer.cancel(); }
			}, 500);
		}
	}
}
