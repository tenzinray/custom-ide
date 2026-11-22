/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Credential } from '@earendil-works/pi-ai';
import type { PiChatOpenAILimits } from '../../../src/vs/workbench/contrib/piChat/common/pi-chat-openai-limits-types.js';
import type { fetchPiChatOpenAILimitsWithToken } from './PiChatOpenAILimitsService.js';

/** Read-only per-login quota cache. Never selects accounts, refreshes OAuth, or holds the auth-file lock. */
export class PiChatOpenAIAccountLimitsService {
	private readonly accounts = new Map<string, { accessToken: string; limits?: PiChatOpenAILimits; attemptedAt: number; pending?: Promise<void> }>();

	private readonly fetchLimits: typeof fetchPiChatOpenAILimitsWithToken;
	private readonly now: () => number;

	constructor(fetchLimits: typeof fetchPiChatOpenAILimitsWithToken, now: () => number = Date.now) {
		this.fetchLimits = fetchLimits;
		this.now = now;
	}

	get(id: string, credential: Credential | undefined): PiChatOpenAILimits | undefined {
		if (credential?.type !== 'oauth' || credential.expires <= this.now()) { this.accounts.delete(id); return undefined; }
		let entry = this.accounts.get(id);
		if (!entry || entry.accessToken !== credential.access) {
			entry = { accessToken: credential.access, attemptedAt: -Infinity };
			this.accounts.set(id, entry);
		}
		if (!entry.pending && this.now() - entry.attemptedAt >= 60_000) {
			entry.attemptedAt = this.now();
			const current = entry;
			current.pending = this.fetchLimits(current.accessToken, typeof credential.accountId === 'string' ? credential.accountId : undefined)
				.then(limits => { current.limits = limits; }, () => { current.limits = undefined; })
				.finally(() => { current.pending = undefined; });
		}
		return entry.limits;
	}

	retain(ids: readonly string[]): void {
		for (const id of this.accounts.keys()) { if (!ids.includes(id)) { this.accounts.delete(id); } }
	}
}
