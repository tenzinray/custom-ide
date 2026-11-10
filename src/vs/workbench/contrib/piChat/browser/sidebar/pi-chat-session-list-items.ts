/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { PiChatSessionSummary } from '../../common/pi-chat-types.js';
import { PiChatSessionListService } from '../PiChatSessionListService.js';

// Same age rule and absolute date format as pi-ui/ChatSidebar.tsx.
function formatSessionAge(timestamp: string, now: number): string {
	const minutes = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 60_000));
	return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

/** Session identity and timestamps shared by sidebar and resume choices. */
export function renderPiChatSessionDetails(parent: HTMLElement, session: PiChatSessionSummary, now: number): void {
	const details = append(parent, $('span.pi-chat-session-details'));
	append(details, $('span.pi-chat-session-name', {}, session.repoName));
	if (session.isDraft) { append(details, $('span.pi-chat-session-date', {}, localize('piChat.newChat', "New Chat"))); }
	else {
		const timestamp = append(details, $('span.pi-chat-session-timestamp'));
		append(timestamp, $('time.pi-chat-session-date', { dateTime: session.lastMessageAt }, new Date(session.lastMessageAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })));
		append(timestamp, $('span.pi-chat-session-age', {}, formatSessionAge(session.lastMessageAt, now)));
	}
}

/** The same page action and label on both session surfaces. */
export function createPiChatSessionLoadMoreButton(parent: HTMLElement): HTMLButtonElement {
	return append(parent, $('button.pi-chat-load-more', { type: 'button' }, localize('piChat.loadMoreSessions', "Load {0} More", PiChatSessionListService.pageSize))) as HTMLButtonElement;
}
