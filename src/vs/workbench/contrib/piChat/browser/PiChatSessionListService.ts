/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { isUUID } from '../../../../base/common/uuid.js';
import { IFileService, IFileStatWithMetadata } from '../../../../platform/files/common/files.js';
import { IPathService } from '../../../../platform/path/common/pathService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { PiChatSessionSummary } from '../common/pi-chat-types.js';
import { PiChatSessionMetadataService } from './PiChatSessionMetadataService.js';

const pinnedSessionsKey = 'piChat.pinnedSessions';

/** Owns persisted session pins and paged metadata reads for recent conversations. */
export class PiChatSessionListService {
	static readonly initialLimit = 3;
	static readonly pageSize = 5;

	private indexedFiles: Promise<IFileStatWithMetadata[]> | undefined;
	private indexedAt = 0;
	private readonly metadata: PiChatSessionMetadataService;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@IStorageService private readonly storage: IStorageService,
	) {
		this.metadata = PiChatSessionMetadataService.getInstance(fileService, storage);
	}

	getPinnedIds(): ReadonlySet<string> {
		const saved = this.storage.getObject<string[]>(pinnedSessionsKey, StorageScope.PROFILE, []);
		return new Set(Array.isArray(saved) ? saved.filter(id => typeof id === 'string') : []);
	}

	setPinned(id: string, pinned: boolean): void {
		const ids = new Set(this.getPinnedIds());
		if (pinned) { ids.add(id); }
		else { ids.delete(id); }
		this.storage.store(pinnedSessionsKey, [...ids], StorageScope.PROFILE, StorageTarget.MACHINE);
	}

	onDidChangePins(disposables: DisposableStore, listener: () => void): void {
		disposables.add(this.storage.onDidChangeValue(StorageScope.PROFILE, pinnedSessionsKey, disposables)(listener));
	}

	onDidChangeSummaries(disposables: DisposableStore, listener: () => void): void {
		this.metadata.onDidChange(disposables, listener);
	}

	invalidate(): void {
		this.indexedFiles = undefined;
	}

	async listSessions(limit: number): Promise<{ sessions: PiChatSessionSummary[]; hasMore: boolean }> {
		const files = await this.getFiles();
		const pinnedIds = this.getPinnedIds();
		const sessions: PiChatSessionSummary[] = [];
		let index = 0;
		while (sessions.length < limit && index < files.length) {
			const batch = files.slice(index, index + limit - sessions.length);
			index += batch.length;
			const page = await Promise.all(batch.map(file => this.metadata.getSummary(file)));
			sessions.push(...page.filter((summary): summary is PiChatSessionSummary => summary !== undefined && !pinnedIds.has(summary.id)));
		}
		return { sessions: sessions.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)), hasMore: index < files.length };
	}

	async findSession(id: string): Promise<PiChatSessionSummary | undefined> {
		const files = await this.getFiles();
		const file = files.find(file => file.name.endsWith(`_${id}.jsonl`));
		if (file) { return this.metadata.getSummary(file); }
		// Native filenames encode UUIDs: a missing pin must not scan every native transcript.
		// Only older/custom filenames need a small header read to discover their identity.
		for (const candidate of files) {
			if (candidate.name.at(-43) === '_' && isUUID(candidate.name.slice(-42, -6))) { continue; }
			try {
				if (await this.metadata.getSessionId(candidate) === id) { return this.metadata.getSummary(candidate); }
			} catch { /* Ignore invalid or deleted files. */ }
		}
		return undefined;
	}

	private async getFiles(): Promise<IFileStatWithMetadata[]> {
		if (this.indexedFiles && Date.now() - this.indexedAt < 15_000) { return this.indexedFiles; }
		this.indexedAt = Date.now();
		// Pi's default getAgentDir()/sessions; the runtime integration will own custom Pi directory settings.
		const sessionsRoot = joinPath(this.pathService.userHome({ preferLocal: true }), '.pi', 'agent', 'sessions');
		this.indexedFiles = (async () => {
			try {
				const root = await this.fileService.resolve(sessionsRoot);
				const directories = (root.children ?? []).filter(child => child.isDirectory);
				const contents = await Promise.all(directories.map(async directory => {
					try { return (await this.fileService.resolve(directory.resource, { resolveMetadata: true })).children ?? []; }
					catch { return []; }
				}));
				return contents.flat().filter((file): file is IFileStatWithMetadata => !file.isDirectory && file.name.endsWith('.jsonl') && typeof file.mtime === 'number' && typeof file.size === 'number')
					.sort((a, b) => b.mtime - a.mtime);
			} catch { return []; }
		})();
		return this.indexedFiles;
	}
}
