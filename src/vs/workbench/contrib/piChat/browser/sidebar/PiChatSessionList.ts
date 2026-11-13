/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { fillPiChatDragData } from '../PiChatGroupDropTarget.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { PiChatSessionSummary } from '../../common/pi-chat-types.js';
import { createPiChatSessionLoadMoreButton, renderPiChatSessionDetails } from './pi-chat-session-list-items.js';

/** Selection opens secondary tabs; split opens secondary groups; drag also supports editor groups. */
export function renderPiChatSessionList(list: HTMLElement, sessions: PiChatSessionSummary[], pinnedIds: ReadonlySet<string>, hasMore: boolean, selectedId: string | undefined, instantiationService: IInstantiationService, onSelect: (session: PiChatSessionSummary) => void, onSplit: (session: PiChatSessionSummary) => void, onLoadMore: () => void, onTogglePin: (session: PiChatSessionSummary) => void, onRename: (session: PiChatSessionSummary, label: HTMLElement) => void): void {
	clearNode(list);
	const now = Date.now();
	const pinned = sessions.filter(session => pinnedIds.has(session.id));
	const recent = sessions.filter(session => !pinnedIds.has(session.id));
	for (const [heading, items, empty] of [
		[localize('piChat.pinned', "Pinned"), pinned, localize('piChat.noPinned', "No pinned chats yet.")],
		[localize('piChat.recent', "Recent"), recent, localize('piChat.noRecent', "No recent chats.")],
	] as const) {
		const section = append(list, $('section.pi-chat-session-section', { 'aria-label': heading }));
		append(section, $('h3.pi-chat-session-heading', {}, heading));
		if (!items.length) { append(section, $('p.pi-chat-sidebar-note', {}, empty)); }
		for (const session of items) {
			const row = append(section, $('.pi-chat-session-row'));
			const button = append(row, $('button.pi-chat-session-button', { title: session.repoPath, 'aria-current': session.id === selectedId ? 'page' : undefined }));
			if (session.id === selectedId) { button.classList.add('pi-chat-session-focused'); }
			const name = renderPiChatSessionDetails(button, session, now);
			name.addEventListener('click', event => { event.stopPropagation(); onRename(session, name); });
			button.addEventListener('click', () => onSelect(session));
			button.addEventListener('keydown', event => {
				if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); onRename(session, name); }
			});
			const isPinned = pinnedIds.has(session.id);
			const pinLabel = isPinned ? localize('piChat.unpin', "Unpin Chat") : localize('piChat.pin', "Pin Chat");
			const pin = append(row, $(`button.pi-chat-session-pin.codicon.codicon-${isPinned ? 'pinned' : 'pin'}`, { 'aria-label': pinLabel, 'aria-pressed': String(isPinned) }));
			pin.addEventListener('click', () => onTogglePin(session));
			const split = append(row, $('button.pi-chat-session-split.codicon.codicon-split-horizontal', { 'aria-label': localize('piChat.splitSession', "Open {0} in Split View", session.repoName) }));
			split.addEventListener('click', () => onSplit(session));
			if (!session.isDraft) {
				row.draggable = true;
				row.addEventListener('dragstart', event => {
					fillPiChatDragData(instantiationService, session, event);
				});
			}
		}
	}
	if (hasMore) {
		const more = createPiChatSessionLoadMoreButton(list);
		more.addEventListener('click', onLoadMore);
	}
}
