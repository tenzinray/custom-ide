/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { PiChatQueuedPrompt } from '../common/pi-chat-run-types.js';
import { PiChatSessionSummary } from '../common/pi-chat-types.js';

const cacheKey = 'piChat.inputCache';
interface Cache {
	recent: string[];
	queued: Record<string, PiChatQueuedPrompt[]>;
	draftSession?: { id: string; repoName: string; repoPath: string; lastMessageAt: string; sessionFile: string };
}

/** VS Code's machine-local profile storage is shared by editor and sidebar, and survives reloads. */
export class PiChatInputCacheService {
	constructor(@IStorageService private readonly storage: IStorageService) { }

	private read(): Cache {
		try {
			const saved = JSON.parse(this.storage.get(cacheKey, StorageScope.PROFILE, '{}')) as Partial<Cache>;
			return { recent: Array.isArray(saved.recent) ? saved.recent : [], queued: saved.queued ?? {}, ...(saved.draftSession ? { draftSession: saved.draftSession } : {}) };
		} catch { return { recent: [], queued: {} }; }
	}

	private write(cache: Cache): void {
		this.storage.store(cacheKey, JSON.stringify(cache), StorageScope.PROFILE, StorageTarget.MACHINE);
	}

	getDraft(id: string): string { return this.storage.get(`piChat.draft.${id}`, StorageScope.PROFILE, ''); }

	setDraft(id: string, text: string): void {
		const key = `piChat.draft.${id}`;
		if (text) { this.storage.store(key, text.slice(0, 20_000), StorageScope.PROFILE, StorageTarget.MACHINE); }
		else { this.storage.remove(key, StorageScope.PROFILE); }
	}

	getRecent(): readonly string[] { return this.read().recent; }

	recordSent(text: string): void {
		const cache = this.read();
		cache.recent = [text, ...cache.recent.filter(item => item !== text)].slice(0, 20);
		this.write(cache);
	}

	getQueued(id: string): PiChatQueuedPrompt[] { return this.read().queued[id] ?? []; }

	setQueued(id: string, items: PiChatQueuedPrompt[]): void {
		const cache = this.read();
		if (items.length) { cache.queued[id] = items; }
		else { delete cache.queued[id]; }
		this.write(cache);
	}

	getDraftSession(): PiChatSessionSummary | undefined {
		const saved = this.read().draftSession;
		return saved ? { ...saved, sessionFile: URI.file(saved.sessionFile), isDraft: true } : undefined;
	}

	setDraftSession(summary: PiChatSessionSummary | undefined): void {
		const cache = this.read();
		if (summary) { cache.draftSession = { id: summary.id, repoName: summary.repoName, repoPath: summary.repoPath, lastMessageAt: summary.lastMessageAt, sessionFile: summary.sessionFile.fsPath }; }
		else { delete cache.draftSession; }
		this.write(cache);
	}
}
