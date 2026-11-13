/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { basename, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService, IFileStatWithMetadata } from '../../../../platform/files/common/files.js';
import { IPathService } from '../../../../platform/path/common/pathService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { PiChatSessionSummary } from '../common/pi-chat-types.js';

const pinnedSessionsKey = 'piChat.pinnedSessions';

/** Owns persisted session pins and paged metadata reads for recent conversations. */
export class PiChatSessionListService {
	static readonly initialLimit = 3;
	static readonly pageSize = 5;

	private indexedFiles: Promise<IFileStatWithMetadata[]> | undefined;
	private indexedAt = 0;
	private readonly summaries = new Map<string, { mtime: number; size: number; summary: PiChatSessionSummary | undefined }>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@IStorageService private readonly storage: IStorageService,
	) { }

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
			const page = await Promise.all(batch.map(file => this.getSummary(file)));
			sessions.push(...page.filter((summary): summary is PiChatSessionSummary => summary !== undefined && !pinnedIds.has(summary.id)));
		}
		return { sessions: sessions.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)), hasMore: index < files.length };
	}

	async findSession(id: string): Promise<PiChatSessionSummary | undefined> {
		const files = await this.getFiles();
		const file = files.find(file => file.name.endsWith(`_${id}.jsonl`));
		if (file) { return this.getSummary(file); }
		// Older/custom Pi filenames may not encode the id; fall back only for those.
		for (const candidate of files) {
			const summary = await this.getSummary(candidate);
			if (summary?.id === id) { return summary; }
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

	private async getSummary(file: IFileStatWithMetadata): Promise<PiChatSessionSummary | undefined> {
		const key = file.resource.toString();
		const cached = this.summaries.get(key);
		if (cached?.mtime === file.mtime && cached.size === file.size) { return cached.summary; }
		const summary = await this.readSummary(file.resource, file.size, cached && file.size > cached.size ? cached : undefined);
		this.summaries.set(key, { mtime: file.mtime, size: file.size, summary });
		return summary;
	}

	private async readSummary(sessionFile: URI, size: number, previous?: { size: number; summary: PiChatSessionSummary | undefined }): Promise<PiChatSessionSummary | undefined> {
		try {
			const headerText = (await this.fileService.readFile(sessionFile, { position: 0, length: Math.min(size, 16_384) })).value.toString().split('\n')[0];
			const header = JSON.parse(headerText) as { type?: string; id?: string; cwd?: string; timestamp?: string } | null;
			if (!header || header.type !== 'session' || typeof header.id !== 'string' ||
				typeof header.cwd !== 'string' || typeof header.timestamp !== 'string') {
				return undefined;
			}
			let lastMessageAt = previous?.summary?.lastMessageAt ?? header.timestamp;
			let sessionName = previous?.summary?.sessionName;
			let foundMessage = false;
			let foundName = false;
			let position = size;
			let carry = VSBuffer.alloc(0);
			// Names can precede arbitrarily long turns. Scan backwards in bounded chunks;
			// cached append-only files only need their new tail, not the whole transcript.
			while (position > 0 && !(foundMessage && foundName)) {
				const count = Math.min(position, 65_536);
				position -= count;
				const chunk = (await this.fileService.readFile(sessionFile, { position, length: count })).value;
				const buffer = VSBuffer.concat([chunk, carry]);
				const firstNewline = position ? buffer.buffer.indexOf(10) : -1;
				carry = firstNewline < 0 && position ? buffer : buffer.slice(0, Math.max(0, firstNewline));
				const lines = (position ? firstNewline < 0 ? '' : buffer.slice(firstNewline + 1).toString() : buffer.toString()).split('\n');
				for (let index = lines.length - 1; index >= 0; index--) {
					try {
						const entry = JSON.parse(lines[index]) as { type?: string; name?: string; timestamp?: string; message?: { role?: string; timestamp?: number } };
						if (!foundName && entry.type === 'session_info' && typeof entry.name === 'string') {
							sessionName = entry.name;
							foundName = true;
						}
						if (!foundMessage && entry.type === 'message' && (entry.message?.role === 'user' || entry.message?.role === 'assistant')) {
							const timestamp = entry.message.timestamp ? new Date(entry.message.timestamp).toISOString() : entry.timestamp;
							if (timestamp && !Number.isNaN(Date.parse(timestamp))) {
								lastMessageAt = timestamp;
								foundMessage = true;
							}
						}
					} catch { /* Ignore a partial or malformed JSONL line. */ }
				}
				if (previous?.summary && position + carry.byteLength <= previous.size) { break; }
			}
			return { id: header.id, repoName: basename(URI.file(header.cwd)) || header.cwd, sessionName, repoPath: header.cwd, lastMessageAt, sessionFile };
		} catch {
			return undefined;
		}
	}
}
