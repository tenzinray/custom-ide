/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { fillEditorsDragData } from '../../../../browser/dnd.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { PiChatSessionSummary } from '../../common/pi-chat-types.js';
import { PiChatSessionEditorInput } from '../PiChatSessionEditorInput.js';
import { createPiChatSessionLoadMoreButton, renderPiChatSessionDetails } from './pi-chat-session-list-items.js';

/** Pi UI list rows: selection opens secondary chat; split control and drag open editor tabs. */
export function renderPiChatSessionList(list: HTMLElement, sessions: PiChatSessionSummary[], limit: number, hasMore: boolean, selectedId: string | undefined, instantiationService: IInstantiationService, onSelect: (session: PiChatSessionSummary) => void, onSplit: (session: PiChatSessionSummary) => void, onLoadMore: () => void): void {
	clearNode(list);
	const now = Date.now();
	if (!sessions.length) {
		append(list, $('p.pi-chat-sidebar-note', {}, 'No saved Pi conversations found.'));
		return;
	}
	for (const session of sessions.slice(0, limit)) {
		const row = append(list, $('.pi-chat-session-row'));
		const button = append(row, $('button.pi-chat-session-button', { title: session.repoPath, 'aria-current': session.id === selectedId ? 'page' : undefined }));
		if (session.id === selectedId) { button.classList.add('pi-chat-session-focused'); }
		append(button, $('span.codicon.codicon-comment-discussion', { 'aria-hidden': 'true' }));
		renderPiChatSessionDetails(button, session, now);
		button.addEventListener('click', () => onSelect(session));
		const split = append(row, $('button.pi-chat-session-split.codicon.codicon-split-horizontal', { 'aria-label': `Open ${session.repoName} in split view`, title: 'Open in split view' }));
		split.addEventListener('click', () => onSplit(session));
		if (!session.isDraft) {
			row.draggable = true;
			row.addEventListener('dragstart', event => {
				instantiationService.invokeFunction(accessor => fillEditorsDragData(accessor, [PiChatSessionEditorInput.resourceForSession(session.id)], event));
			});
		}
	}
	if (hasMore) {
		const more = createPiChatSessionLoadMoreButton(list);
		more.addEventListener('click', onLoadMore);
	}
}
