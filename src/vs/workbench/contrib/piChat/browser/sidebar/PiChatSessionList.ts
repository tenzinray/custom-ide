/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { fillEditorsDragData } from '../../../../browser/dnd.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { PiChatSessionSummary } from '../../common/pi-chat-types.js';
import { PiChatSessionEditorInput } from '../PiChatSessionEditorInput.js';
import { createPiChatSessionLoadMoreButton, renderPiChatSessionDetails } from './pi-chat-session-list-items.js';

/** Pi UI list rows: selection opens secondary chat; split control and drag open editor tabs. */
export function renderPiChatSessionList(list: HTMLElement, sessions: PiChatSessionSummary[], pinnedIds: ReadonlySet<string>, hasMore: boolean, selectedId: string | undefined, instantiationService: IInstantiationService, onSelect: (session: PiChatSessionSummary) => void, onSplit: (session: PiChatSessionSummary) => void, onLoadMore: () => void, onTogglePin: (session: PiChatSessionSummary) => void): void {
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
			renderPiChatSessionDetails(button, session, now);
			button.addEventListener('click', () => onSelect(session));
			const isPinned = pinnedIds.has(session.id);
			const pinLabel = isPinned ? localize('piChat.unpin', "Unpin Chat") : localize('piChat.pin', "Pin Chat");
			const pin = append(row, $(`button.pi-chat-session-pin.codicon.codicon-${isPinned ? 'pinned' : 'pin'}`, { 'aria-label': pinLabel, 'aria-pressed': String(isPinned) }));
			pin.addEventListener('click', () => onTogglePin(session));
			const split = append(row, $('button.pi-chat-session-split.codicon.codicon-split-horizontal', { 'aria-label': `Open ${session.repoName} in split view`, title: 'Open in split view' }));
			split.addEventListener('click', () => onSplit(session));
			if (!session.isDraft) {
				row.draggable = true;
				row.addEventListener('dragstart', event => {
					instantiationService.invokeFunction(accessor => fillEditorsDragData(accessor, [PiChatSessionEditorInput.resourceForSession(session.id)], event));
				});
			}
		}
	}
	if (hasMore) {
		const more = createPiChatSessionLoadMoreButton(list);
		more.addEventListener('click', onLoadMore);
	}
}
