/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseLineAndColumnAware } from '../../../../base/common/extpath.js';
import { matchesScheme, Schemas } from '../../../../base/common/network.js';
import { posix, win32 } from '../../../../base/common/path.js';
import { basename, isEqualOrParent, joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextEditorSelection, ITextResourceEditorInput } from '../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { extractSelection } from '../../../../platform/opener/common/opener.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IPathService } from '../../../../platform/path/common/pathService.js';
import { getProjectsDirectory } from '../../../../platform/workspaces/common/projectDirectories.js';
import { listGitRepositories } from '../../workspace/browser/gitRepositories.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { escapeGlobPattern } from '../../../services/search/common/queryBuilder.js';
import { ISearchService, QueryType } from '../../../services/search/common/search.js';

/** Resolves agent file references against the owning chat, never the active workspace/editor. */
export class PiChatFileLinkService {
	private readonly cache = new Map<string, { expires: number; result: Promise<ITextResourceEditorInput | undefined> }>();
	private repositories: ReturnType<typeof listGitRepositories> | undefined;

	constructor(
		@IFileService private readonly files: IFileService,
		@ISearchService private readonly search: ISearchService,
		@IEditorService private readonly editors: IEditorService,
		@IPathService private readonly paths: IPathService,
		@INotificationService private readonly notifications: INotificationService,
	) {}

	isFileReference(reference: string): boolean {
		if (!reference || reference.startsWith('#')) { return false; }
		try {
			const path = parseLineAndColumnAware(reference).path;
			return win32.isAbsolute(path) || !/^[a-z][a-z\d+.-]*:/i.test(path) || matchesScheme(path, Schemas.file);
		} catch { return false; }
	}

	resolve(reference: string, repoPath: string): Promise<ITextResourceEditorInput | undefined> {
		const key = `${repoPath}\n${reference}`;
		const cached = this.cache.get(key);
		if (cached && cached.expires > Date.now()) { return cached.result; }
		if (this.cache.size >= 500) { this.cache.delete(this.cache.keys().next().value!); }
		// Streaming responses re-render often. Briefly share lookups without hiding newly created files.
		const result = this.resolveFile(reference, URI.file(repoPath)).catch(() => undefined);
		const entry = { expires: Number.POSITIVE_INFINITY, result };
		this.cache.set(key, entry);
		void result.then(() => { entry.expires = Date.now() + 1000; });
		return result;
	}

	/** Shorten file-tool labels only; resolution and opening always use the original reference. */
	async getToolPathLabel(reference: string, repoPath: string): Promise<string> {
		if (!posix.isAbsolute(reference) && !win32.isAbsolute(reference)) { return reference; }
		const resource = URI.file(reference);
		const repo = URI.file(repoPath);
		if (isEqualOrParent(resource, repo)) { return relativePath(repo, resource) || reference; }
		const home = this.paths.userHome({ preferLocal: true });
		const projects = getProjectsDirectory(home);
		if (!isEqualOrParent(resource, projects)) { return reference; }
		// Share discovery across streaming renders, using the same repositories as the picker.
		this.repositories ??= listGitRepositories(home, this.files).catch(() => {
			this.repositories = undefined;
			return [];
		});
		const repositories = await this.repositories;
		return repositories.some(repository => isEqualOrParent(repository.folderUri, projects) && isEqualOrParent(resource, repository.folderUri))
			? relativePath(projects, resource) || reference : reference;
	}

	async open(input: ITextResourceEditorInput): Promise<void> {
		try { await this.editors.openEditor(input); }
		catch (error) { this.notifications.error(error instanceof Error ? error : String(error)); }
	}

	private async resolveFile(reference: string, repo: URI): Promise<ITextResourceEditorInput | undefined> {
		if (!this.isFileReference(reference)) { return undefined; }
		let path = reference;
		let selection: ITextEditorSelection | undefined;
		if (matchesScheme(path, Schemas.file)) {
			const extracted = extractSelection(URI.parse(path));
			const parsed = parseLineAndColumnAware(extracted.uri.fsPath);
			const resource = URI.file(parsed.path);
			selection = extracted.selection ?? (parsed.line !== undefined ? { startLineNumber: parsed.line, startColumn: parsed.column ?? 1 } : undefined);
			if (!await this.isFile(resource)) { return undefined; }
			return { resource, options: { selection, pinned: true } };
		}
		try { path = decodeURIComponent(path); } catch { /* Literal percent characters are valid in filenames. */ }
		const hash = path.lastIndexOf('#');
		if (hash >= 0) {
			const extracted = extractSelection(URI.file(path.slice(0, hash)).with({ fragment: path.slice(hash + 1) }));
			if (extracted.selection) { selection = extracted.selection; path = path.slice(0, hash); }
		}
		const parsed = parseLineAndColumnAware(path);
		path = parsed.path;
		if (!selection && parsed.line !== undefined) { selection = { startLineNumber: parsed.line, startColumn: parsed.column ?? 1 }; }
		if (!path || /[\r\n\0]/.test(path)) { return undefined; }
		const absolute = posix.isAbsolute(path) || win32.isAbsolute(path);
		const homeRelative = path.startsWith('~/');
		let resource = absolute ? URI.file(path) : homeRelative ? joinPath(this.paths.userHome({ preferLocal: true }), path.slice(2)) : joinPath(repo, path.replace(/\\/g, '/'));
		if (!absolute && !homeRelative && !/[\\/]/.test(path)) {
			// Like Copilot, never guess when a bare filename has multiple matches.
			const matches = new Map<string, URI>();
			if (await this.isFile(resource)) { matches.set(resource.toString(), resource); }
			const result = await this.search.fileSearch({
				type: QueryType.File,
				folderQueries: [{ folder: repo }],
				includePattern: { [`**/${escapeGlobPattern(path)}`]: true },
				maxResults: 2,
			});
			if (result.limitHit) { return undefined; }
			for (const match of result.results) {
				if (isEqualOrParent(match.resource, repo) && basename(match.resource) === path) { matches.set(match.resource.toString(), match.resource); }
			}
			if (matches.size !== 1) { return undefined; }
			resource = matches.values().next().value!;
		}
		if (!await this.isFile(resource)) { return undefined; }
		return { resource, options: { selection, pinned: true } };
	}

	private async isFile(resource: URI): Promise<boolean> {
		try { return (await this.files.stat(resource)).isFile; } catch { return false; }
	}
}
