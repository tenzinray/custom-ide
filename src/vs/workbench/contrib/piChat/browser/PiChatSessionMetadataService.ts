/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { streamToBuffer } from '../../../../base/common/buffer.js';
import { timeout } from '../../../../base/common/async.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { listenStream } from '../../../../base/common/stream.js';
import { Mutable } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService, IFileStatWithMetadata } from '../../../../platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { PiChatSessionSummary } from '../common/pi-chat-types.js';
import { PiChatSessionNameDiagnostics } from './PiChatSessionNameDiagnostics.js';

const metadataKey = 'piChat.sessionMetadata.v1';
const probeSize = 65_536;

interface SessionMetadata {
	mtime: number;
	size: number;
	complete: boolean;
	summary: Mutable<Omit<PiChatSessionSummary, 'sessionFile'>>;
}

/** One reader per profile, shared by sidebar, pins and resume choices. Transcripts stay authoritative. */
export class PiChatSessionMetadataService {
	private static readonly instances = new WeakMap<IStorageService, PiChatSessionMetadataService>();
	static getInstance(files: IFileService, storage: IStorageService, diagnostics: PiChatSessionNameDiagnostics): PiChatSessionMetadataService {
		let instance = this.instances.get(storage);
		if (!instance) { instance = new PiChatSessionMetadataService(files, storage, diagnostics); this.instances.set(storage, instance); }
		return instance;
	}

	private readonly summaries = new Map<string, SessionMetadata>();
	private readonly pending = new Map<string, { mtime: number; size: number; read: Promise<PiChatSessionSummary | undefined> }>();
	private readonly hydrating = new Map<string, Promise<void>>();

	private constructor(private readonly files: IFileService, private readonly storage: IStorageService, private readonly diagnostics: PiChatSessionNameDiagnostics) { }

	onDidChange(disposables: DisposableStore, listener: () => void): void {
		disposables.add(this.storage.onDidChangeValue(StorageScope.PROFILE, metadataKey, disposables)(listener));
	}

	async getSummary(file: IFileStatWithMetadata): Promise<PiChatSessionSummary | undefined> {
		const key = file.resource.toString();
		const cached = this.summaries.get(key) ?? this.storage.getObject<Record<string, SessionMetadata>>(metadataKey, StorageScope.PROFILE, {})[key];
		if (cached?.mtime === file.mtime && cached.size === file.size) {
			if (!cached.complete && !this.summaries.has(key)) { this.summaries.set(key, cached); this.hydrate(file, cached, undefined); }
			this.diagnostics.observe('metadata.cache', { ...cached.summary, sessionFile: file.resource });
			return { ...cached.summary, sessionFile: file.resource };
		}
		const pending = this.pending.get(key);
		if (pending) {
			if (pending.mtime === file.mtime && pending.size === file.size) { return pending.read; }
			await pending.read;
			return this.getSummary(file);
		}
		const read = this.probe(file, cached).catch(() => {
			this.diagnostics.record('metadata.probe.failed', cached?.summary, { mtime: file.mtime, size: file.size });
			return undefined;
		}).finally(() => this.pending.delete(key));
		this.pending.set(key, { mtime: file.mtime, size: file.size, read });
		return read;
	}

	async getSessionId(file: IFileStatWithMetadata): Promise<string | undefined> {
		return (await this.readHeader(file)).header?.id;
	}

	private async readRange(file: IFileStatWithMetadata, position: number, length: number): Promise<string> {
		const content = await this.files.readFileStream(file.resource, { position, length });
		try { return (await streamToBuffer(content.value)).toString(); }
		finally { content.value.destroy(); }
	}

	private async readHeader(file: IFileStatWithMetadata) {
		const head = await this.readRange(file, 0, Math.min(file.size, 16_384));
		const header = JSON.parse(head.split('\n')[0]) as { type?: string; id?: string; cwd?: string; timestamp?: string } | null;
		return { head, header };
	}

	private async probe(file: IFileStatWithMetadata, cached: SessionMetadata | undefined): Promise<PiChatSessionSummary | undefined> {
		const { head, header } = await this.readHeader(file);
		if (!header || header.type !== 'session' || typeof header.id !== 'string' || typeof header.cwd !== 'string' || typeof header.timestamp !== 'string') { return undefined; }
		// Only an entirely indexed, newline-terminated prefix can seed an append-only update.
		const previous = cached?.complete && cached.size < file.size && cached.summary.id === header.id ? cached : undefined;
		const summary: SessionMetadata['summary'] = previous ? { ...previous.summary } : {
			id: header.id, repoName: basename(URI.file(header.cwd)) || header.cwd, repoPath: header.cwd, lastMessageAt: header.timestamp,
		};
		// Head names are a useful provisional label; the background scan checks for later renames.
		if (!previous) { for (const line of head.split('\n').slice(1, -1)) { this.applyLine(summary, line, 'head'); } }
		const position = Math.max(previous?.size ?? 0, file.size - probeSize);
		const tail = await this.readRange(file, position, file.size - position);
		const atBoundary = position === (previous?.size ?? 0);
		const lines = tail.split('\n');
		for (const line of atBoundary ? lines : lines.slice(1)) { this.applyLine(summary, line, 'tail'); }
		const metadata: SessionMetadata = { mtime: file.mtime, size: file.size, summary, complete: atBoundary && tail.endsWith('\n') };
		this.diagnostics.record('metadata.probe.publish', summary, { previousName: cached?.summary.sessionName ?? null, previousComplete: cached?.complete ?? false, previousSize: cached?.size, mtime: file.mtime, size: file.size, position, seededFromPrevious: !!previous, complete: metadata.complete });
		this.summaries.set(file.resource.toString(), metadata);
		if (metadata.complete) { this.persist(file, metadata); }
		else { this.hydrate(file, metadata, previous); }
		return { ...summary, sessionFile: file.resource };
	}

	private applyLine(summary: SessionMetadata['summary'], line: string, source: 'head' | 'tail' | 'background'): void {
		try {
			const entry = JSON.parse(line) as { type?: string; name?: string; timestamp?: string; message?: { role?: string; timestamp?: number } };
			if (entry.type === 'session_info' && typeof entry.name === 'string') {
				if (summary.sessionName !== entry.name) { this.diagnostics.record(`metadata.nativeName.${source}`, { ...summary, sessionName: entry.name }, { previousName: summary.sessionName ?? null }); }
				summary.sessionName = entry.name;
			}
			if (entry.type === 'message' && (entry.message?.role === 'user' || entry.message?.role === 'assistant')) {
				const timestamp = entry.message.timestamp ? new Date(entry.message.timestamp).toISOString() : entry.timestamp;
				if (timestamp && !Number.isNaN(Date.parse(timestamp))) { summary.lastMessageAt = timestamp; }
			}
		} catch { /* Ignore a partial or malformed JSONL line. */ }
	}

	private hydrate(file: IFileStatWithMetadata, provisional: SessionMetadata, previous: SessionMetadata | undefined): void {
		const key = file.resource.toString();
		const work = (this.hydrating.get(key) ?? Promise.resolve()).then(async () => {
			if (this.summaries.get(key) === provisional) { await this.scan(file, provisional, previous); }
			else { this.diagnostics.record('metadata.background.supersededBeforeStart', provisional.summary, { size: file.size }); }
		}).finally(() => { if (this.hydrating.get(key) === work) { this.hydrating.delete(key); } });
		this.hydrating.set(key, work);
	}

	private async scan(file: IFileStatWithMetadata, provisional: SessionMetadata, previous: SessionMetadata | undefined): Promise<void> {
		const key = file.resource.toString();
		const started = Date.now();
		this.diagnostics.record('metadata.background.start', provisional.summary, { size: file.size, position: previous?.size ?? 0 });
		try {
			// Yield instead of blocking initial metadata requests. No sequential range-read loop.
			await timeout(0);
			const position = previous?.size ?? 0;
			const content = await this.files.readFileStream(file.resource, { position, length: file.size - position });
			const summary = previous ? { ...previous.summary } : { ...provisional.summary };
			const decoder = new TextDecoder();
			let fragments: string[] = [];
			const consume = (text: string) => {
				let start = 0;
				let newline: number;
				while ((newline = text.indexOf('\n', start)) !== -1) {
					fragments.push(text.slice(start, newline));
					this.applyLine(summary, fragments.join(''), 'background');
					fragments = [];
					start = newline + 1;
				}
				if (start < text.length) { fragments.push(text.slice(start)); }
			};
			try {
				await new Promise<void>((resolve, reject) => listenStream(content.value, {
					onData: chunk => consume(decoder.decode(chunk.buffer, { stream: true })), onError: reject, onEnd: resolve,
				}));
				consume(decoder.decode());
			} finally { content.value.destroy(); }
			// A live writer may have left a partial last line. Never treat that offset as an append boundary.
			const complete = fragments.length === 0;
			if (fragments.length) { this.applyLine(summary, fragments.join(''), 'background'); }
			if (this.summaries.get(key) !== provisional) {
				this.diagnostics.record('metadata.background.discarded', summary, { size: file.size, elapsedMs: Date.now() - started });
				return;
			}
			this.diagnostics.record('metadata.background.publish', summary, { provisionalName: provisional.summary.sessionName ?? null, complete, size: file.size, mtime: file.mtime, elapsedMs: Date.now() - started });
			const metadata = { ...provisional, summary, complete };
			this.summaries.set(key, metadata);
			this.persist(file, metadata);
		} catch {
			// Keep the bounded probe result; a later file change can retry.
			this.diagnostics.record('metadata.background.failed', provisional.summary, { size: file.size, elapsedMs: Date.now() - started });
		}
	}

	private persist(file: IFileStatWithMetadata, metadata: SessionMetadata): void {
		const saved = this.storage.getObject<Record<string, SessionMetadata>>(metadataKey, StorageScope.PROFILE, {});
		delete saved[file.resource.toString()];
		saved[file.resource.toString()] = metadata;
		this.diagnostics.record('metadata.persist', metadata.summary, { mtime: metadata.mtime, size: metadata.size, complete: metadata.complete });
		this.storage.store(metadataKey, Object.fromEntries(Object.entries(saved).slice(-200)), StorageScope.PROFILE, StorageTarget.MACHINE);
	}
}
