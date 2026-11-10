/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { PiChatSessionSummary } from '../../common/pi-chat-types.js';

/** Selected-project presentation only; the conversation container owns switching behavior. */
export function renderPiChatNewChat(container: HTMLElement, summary: PiChatSessionSummary, onSwitchProject: () => void): DisposableStore {
	const store = new DisposableStore();
	clearNode(container);
	const body = append(container, $('.pi-chat-empty.pi-chat-new-chat-body'));
	append(body, $('h1', {}, localize('piChat.newChatTitle', "New Chat")));
	const project = append(body, $('.pi-chat-selected-project'));
	append(project, $('span.codicon.codicon-repo', { 'aria-hidden': 'true' }));
	const details = append(project, $('div'));
	append(details, $('strong', {}, summary.repoName));
	append(details, $('small', {}, summary.repoPath));
	const button = append(body, $('button.pi-chat-switch-project', { type: 'button' }, localize('piChat.switchProject', "Switch Project")));
	store.add(addDisposableListener(button, 'click', onSwitchProject));
	return store;
}
