/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { PiChatQueuedPrompt } from '../../../src/vs/workbench/contrib/piChat/common/pi-chat-run-types.js';

type PendingPrompt = PiChatQueuedPrompt & { expanded: string };
type SavedQueue = { steering: string[]; followUp: string[] };

/** Pi owns delivery; these IDs only associate its pending text with UI controls. */
export class PiChatSteeringQueue {
	private readonly pending: PendingPrompt[] = [];
	private deferred: SavedQueue = { steering: [], followUp: [] };

	constructor(private readonly session: AgentSession) { }

	get items(): PiChatQueuedPrompt[] { return this.pending.map(({ id, text }) => ({ id, text })); }
	get needsRestore(): boolean { return !!(this.deferred.steering.length || this.deferred.followUp.length); }

	async add(id: string, text: string): Promise<void> {
		if (this.pending.some(item => item.id === id)) { throw new Error('Prompt is already queued.'); }
		const item = { id, text, expanded: text };
		this.pending.push(item);
		try {
			await this.session.steer(text);
			item.expanded = this.session.getSteeringMessages().at(-1) ?? text;
		} catch (error) {
			this.pending.splice(this.pending.indexOf(item), 1);
			throw error;
		}
	}

	consume(text: string): PiChatQueuedPrompt | undefined {
		const index = this.pending.findIndex(item => item.expanded === text);
		if (index < 0) { return undefined; }
		const [item] = this.pending.splice(index, 1);
		return { id: item.id, text: item.text };
	}

	/** Pi only exposes clearQueue(), so preserve all other steering and follow-up messages. */
	async remove(id: string, restore = true): Promise<PiChatQueuedPrompt | undefined> {
		const index = this.pending.findIndex(item => item.id === id);
		if (index < 0 || !this.session.getSteeringMessages().includes(this.pending[index].expanded)) { return undefined; }
		const [item] = this.pending.splice(index, 1);
		this.captureRemaining(item.expanded);
		if (restore) { await this.restore(); }
		return { id: item.id, text: item.text };
	}

	takeFirst(): PiChatQueuedPrompt | undefined {
		const item = this.pending.shift();
		if (!item) { return undefined; }
		this.captureRemaining(item.expanded);
		return { id: item.id, text: item.text };
	}

	private captureRemaining(removedText: string): void {
		const saved = this.session.clearQueue();
		const index = saved.steering.indexOf(removedText);
		if (index >= 0) { saved.steering.splice(index, 1); }
		this.deferred = saved;
	}

	async restore(): Promise<void> {
		const saved = this.deferred;
		this.deferred = { steering: [], followUp: [] };
		for (const text of saved.steering) { await this.session.sendUserMessage(text, { deliverAs: 'steer' }); }
		for (const text of saved.followUp) { await this.session.sendUserMessage(text, { deliverAs: 'followUp' }); }
	}

	clear(): PiChatQueuedPrompt[] {
		const items = this.items;
		this.session.clearQueue();
		this.pending.length = 0;
		this.deferred = { steering: [], followUp: [] };
		return items;
	}
}
