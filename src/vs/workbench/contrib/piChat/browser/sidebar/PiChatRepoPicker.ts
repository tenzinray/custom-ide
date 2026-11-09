/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { isEqualOrParent } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { GitRepository } from '../../../workspace/browser/gitRepositories.js';

/** Pi UI-style repository picker for a read-only new-chat draft. */
export class PiChatRepoPicker extends Disposable {
	private readonly overlay: HTMLElement;
	private readonly search: HTMLInputElement;
	private readonly list: HTMLElement;
	private readonly suggestions: HTMLElement;
	private repos: GitRepository[] = [];

	constructor(anchor: HTMLElement, private readonly workspaceFolders: readonly URI[], private readonly editorResource: URI | undefined, private readonly onSelect: (name: string, path: string) => void, private readonly onClose: () => void) {
		super();
		// Attach inside the workbench so theme tokens and its font inherit into the dialog.
		this.overlay = append(anchor.closest('.monaco-workbench') ?? anchor, $('.pi-chat-repo-overlay'));
		this.overlay.addEventListener('click', event => { if (event.target === this.overlay) { this.onClose(); } });
		const dialog = append(this.overlay, $('.pi-chat-repo-picker', { role: 'dialog', 'aria-label': 'New chat' }));
		const heading = append(dialog, $('.pi-chat-repo-heading'));
		const info = append(heading, $('div'));
		append(info, $('h2', {}, 'New chat'));
		append(info, $('p', {}, 'Choose a repository to start a Pi conversation.'));
		const close = append(heading, $('button.codicon.codicon-close', { 'aria-label': 'Close', title: 'Close' }));
		close.addEventListener('click', this.onClose);
		this.search = append(dialog, $('input.pi-chat-repo-search', { placeholder: 'Search repositories...', 'aria-label': 'Search repositories' })) as HTMLInputElement;
		this.suggestions = append(dialog, $('.pi-chat-repo-suggestions'));
		this.list = append(dialog, $('.pi-chat-repo-list'));
		this.list.textContent = 'Finding repositories...';
		this.overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { this.onClose(); } });
		this.search.addEventListener('input', () => this.renderRepos());
		this.search.focus();
	}

	setRepos(repos: GitRepository[]): void {
		this.repos = repos;
		this.renderSuggestions();
		this.renderRepos();
	}

	setError(): void {
		this.list.textContent = 'Could not find repositories.';
	}

	private renderSuggestions(): void {
		this.suggestions.replaceChildren();
		const shown = new Set<string>();
		const add = (resource: URI, label: string) => {
			const repo = this.repos.filter(repo => isEqualOrParent(resource, repo.folderUri)).sort((a, b) => b.folderUri.path.length - a.folderUri.path.length)[0];
			if (!repo || shown.has(repo.folderUri.toString())) { return; }
			shown.add(repo.folderUri.toString());
			const button = append(this.suggestions, $('button.pi-chat-repo-suggestion'));
			append(button, $('.codicon.codicon-repo', { 'aria-hidden': 'true' }));
			append(button, $('span', {}, `${label} · ${repo.name}`));
			button.title = repo.folderUri.fsPath;
			button.addEventListener('click', () => this.onSelect(repo.name, repo.folderUri.fsPath));
		};
		for (const folder of this.workspaceFolders) { add(folder, 'Current workspace'); }
		if (this.editorResource) { add(this.editorResource, 'Active editor'); }
	}

	private renderRepos(): void {
		this.list.replaceChildren();
		const matching = this.repos.filter(repo => repo.name.toLowerCase().includes(this.search.value.toLowerCase()));
		if (!matching.length) { append(this.list, $('p', {}, 'No repositories found.')); }
		for (const repo of matching) {
			const button = append(this.list, $('button.pi-chat-repo-item'));
			append(button, $('.codicon.codicon-repo', { 'aria-hidden': 'true' }));
			const text = append(button, $('span'));
			append(text, $('strong', {}, repo.name));
			append(text, $('small', {}, repo.folderUri.fsPath));
			button.addEventListener('click', () => this.onSelect(repo.name, repo.folderUri.fsPath));
		}
	}

	override dispose(): void {
		this.overlay.remove();
		super.dispose();
	}
}
