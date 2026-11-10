/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { GitRepository } from '../../../workspace/browser/gitRepositories.js';

/** Shared picker presentation: local search text, section captions, and identical repo rows. */
export class PiChatRepoPickerBody extends Disposable {
	readonly element: HTMLElement;
	private readonly search: HTMLInputElement;
	private readonly openFolder: HTMLButtonElement;
	private readonly suggestions: HTMLElement;
	private readonly list: HTMLElement;
	private readonly rows = this._register(new DisposableStore());
	private repos: readonly GitRepository[] = [];
	private workspaceRepos: readonly GitRepository[] = [];
	private editorRepo: GitRepository | undefined;
	private busy = false;
	private buttons: HTMLButtonElement[] = [];

	constructor(parent: HTMLElement, private readonly onSelect: (repo: GitRepository) => void, onOpenFolder: () => void) {
		super();
		this.element = append(parent, $('.pi-chat-repo-body'));
		this.search = append(this.element, $('input.pi-chat-repo-search', {
			placeholder: localize('piChat.searchRepos', "Search repositories..."),
			'aria-label': localize('piChat.searchReposLabel', "Search repositories"),
		})) as HTMLInputElement;
		this.openFolder = append(this.element, $('button.pi-chat-repo-open-folder', { type: 'button' }, localize('piChat.openFinder', "Open Finder"))) as HTMLButtonElement;
		this._register(addDisposableListener(this.openFolder, 'click', onOpenFolder));
		this.suggestions = append(this.element, $('.pi-chat-repo-suggestions'));
		this.list = append(this.element, $('.pi-chat-repo-list'));
		this.list.textContent = localize('piChat.findingRepos', "Finding repositories...");
		this._register(addDisposableListener(this.search, 'input', () => this.render()));
		this._register(addDisposableListener(this.search, 'keydown', event => {
			const first = this.buttons.find(button => !button.disabled);
			if (event.key === 'Enter') { event.preventDefault(); first?.click(); }
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				event.stopPropagation();
				(event.key === 'ArrowDown' ? first : this.buttons.findLast(button => !button.disabled))?.focus();
			}
		}));
		this._register(addDisposableListener(this.element, 'keydown', event => {
			if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') { return; }
			const buttons = this.buttons.filter(button => !button.disabled);
			const index = buttons.indexOf(event.target as HTMLButtonElement);
			if (index < 0) { return; }
			event.preventDefault();
			event.stopPropagation();
			const next = index + (event.key === 'ArrowDown' ? 1 : -1);
			if (next < 0) { this.search.focus(); }
			else {
				const button = buttons[Math.min(next, buttons.length - 1)];
				button.focus({ preventScroll: true });
				button.scrollIntoView({ block: 'nearest' });
			}
		}));
	}

	setRepos(repos: readonly GitRepository[], workspaceRepos: readonly GitRepository[], editorRepo: GitRepository | undefined): void {
		this.repos = repos;
		this.workspaceRepos = workspaceRepos;
		this.editorRepo = editorRepo;
		this.render();
	}

	setError(): void {
		this.rows.clear();
		this.buttons = [];
		this.suggestions.replaceChildren();
		this.list.textContent = localize('piChat.repoError', "Could not find repositories.");
	}

	setBusy(busy: boolean): void {
		this.busy = busy;
		this.element.setAttribute('aria-busy', String(busy));
		this.openFolder.disabled = busy;
		for (const button of this.buttons) { button.disabled = busy; }
	}

	focus(): void { this.search.focus(); }

	private render(): void {
		this.rows.clear();
		this.buttons = [];
		this.suggestions.replaceChildren();
		this.list.replaceChildren();
		const query = this.search.value.trim().toLocaleLowerCase();
		const matches = (repo: GitRepository) => repo.name.toLocaleLowerCase().includes(query);
		this.renderSection(this.suggestions, localize('piChat.workspaceRepos', "Current workspace"), this.workspaceRepos.filter(matches), true);
		this.renderSection(this.suggestions, localize('piChat.editorRepo', "Active editor"), this.editorRepo && matches(this.editorRepo) ? [this.editorRepo] : []);
		const repos = this.repos.filter(matches);
		this.renderSection(this.list, localize('piChat.allRepos', "All repositories"), repos);
		if (!repos.length) { append(this.list, $('p', {}, localize('piChat.noRepos', "No repositories found."))); }
	}

	private renderSection(parent: HTMLElement, caption: string, repos: readonly GitRepository[], isWorkspaceSection = false): void {
		if (!repos.length) { return; }
		const section = append(parent, $('.pi-chat-repo-section'));
		append(section, $('.pi-chat-repo-caption', {}, caption));
		const rows = isWorkspaceSection ? append(section, $('.pi-chat-repo-workspace')) : section;
		for (const repo of repos) {
			const button = append(rows, $('button.pi-chat-repo-item', { type: 'button' })) as HTMLButtonElement;
			this.buttons.push(button);
			button.disabled = this.busy;
			append(button, $('.codicon.codicon-repo', { 'aria-hidden': 'true' }));
			const text = append(button, $('span'));
			append(text, $('strong', {}, repo.name));
			append(text, $('small', {}, repo.folderUri.fsPath));
			this.rows.add(addDisposableListener(button, 'click', () => this.onSelect(repo)));
		}
	}

	override dispose(): void { this.element.remove(); super.dispose(); }
}
