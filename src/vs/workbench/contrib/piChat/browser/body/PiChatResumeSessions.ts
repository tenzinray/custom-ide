/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { getPiChatSessionLabel, PiChatSessionSummary } from '../../common/pi-chat-types.js';
import { createPiChatSessionLoadMoreButton, renderPiChatSessionDetails } from '../sidebar/pi-chat-session-list-items.js';

/** Resume-section presentation only; the picker container owns discovery, paging, and selection. */
export class PiChatResumeSessions extends Disposable {
	private readonly element: HTMLElement;
	private readonly rows = this._register(new DisposableStore());
	private sessions: readonly PiChatSessionSummary[] = [];
	private hasMore = false;
	private loading = true;
	private busy = false;
	private query = '';
	private buttons: HTMLButtonElement[] = [];
	private more: HTMLButtonElement | undefined;
	private focusedIndexBeforeLoading = -1;

	constructor(parent: HTMLElement, private readonly onResume: (session: PiChatSessionSummary) => void, private readonly onLoadMore: () => void) {
		super();
		this.element = append(parent, $('section.pi-chat-resume-sessions.pi-chat-repo-section', { 'aria-label': localize('piChat.resumeSession', "Resume Session") }));
		this.render('', false);
	}

	get navigationButtons(): readonly HTMLButtonElement[] { return this.buttons; }

	setSessions(sessions: readonly PiChatSessionSummary[], hasMore: boolean): void {
		this.sessions = sessions;
		this.hasMore = hasMore;
		this.loading = false;
		this.render(this.query, this.busy);
	}

	setLoading(loading: boolean): void {
		if (loading) {
			this.focusedIndexBeforeLoading = this.buttons.indexOf(getWindow(this.element).document.activeElement as HTMLButtonElement);
		}
		this.loading = loading;
		this.element.setAttribute('aria-busy', String(loading));
		if (this.more) { this.more.disabled = this.busy || loading; }
	}

	render(query: string, busy: boolean): void {
		const targetWindow = getWindow(this.element);
		const activeIndex = this.buttons.indexOf(targetWindow.document.activeElement as HTMLButtonElement);
		// Disabling Load More blurs it; restore focus to the first added row unless the user moved elsewhere.
		const focusedIndex = activeIndex >= 0 ? activeIndex : targetWindow.document.activeElement === targetWindow.document.body ? this.focusedIndexBeforeLoading : -1;
		this.focusedIndexBeforeLoading = -1;
		this.query = query;
		this.busy = busy;
		this.rows.clear();
		this.buttons = [];
		this.more = undefined;
		this.element.replaceChildren();
		this.element.setAttribute('aria-busy', String(this.loading));
		append(this.element, $('div.pi-chat-resume-heading.pi-chat-repo-caption', { role: 'heading', 'aria-level': '3' }, localize('piChat.resumeSession', "Resume Session")));
		const sessions = this.sessions.filter(session => getPiChatSessionLabel(session).toLocaleLowerCase().includes(query) || session.repoPath.toLocaleLowerCase().includes(query));
		const now = Date.now();
		for (const session of sessions) {
			const row = append(this.element, $('.pi-chat-session-row'));
			const button = append(row, $('button.pi-chat-session-button', { type: 'button', title: session.repoPath })) as HTMLButtonElement;
			this.buttons.push(button);
			button.disabled = busy;
			renderPiChatSessionDetails(button, session, now);
			this.rows.add(addDisposableListener(button, 'click', () => this.onResume(session)));
		}
		if (!sessions.length) {
			append(this.element, $('p.pi-chat-sidebar-note', {}, this.loading ? localize('piChat.loadingSessions', "Loading recent sessions…")
				: query ? localize('piChat.noMatchingSessions', "No matching recent sessions.") : localize('piChat.noRecentSessions', "No recent sessions.")));
		}
		if (this.hasMore) {
			const more = this.more = createPiChatSessionLoadMoreButton(this.element);
			this.buttons.push(more);
			more.disabled = busy || this.loading;
			this.rows.add(addDisposableListener(more, 'click', this.onLoadMore));
		}
		if (focusedIndex >= 0) {
			const buttons = this.buttons.filter(button => !button.disabled);
			buttons[Math.min(focusedIndex, buttons.length - 1)]?.focus({ preventScroll: true });
		}
	}
}
