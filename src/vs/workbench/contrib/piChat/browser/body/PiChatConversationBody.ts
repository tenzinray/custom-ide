/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, getWindow } from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { PiChatMessage, PiChatSessionHistory } from '../../common/pi-chat-types.js';
import { PiChatQueuedPrompt } from '../../common/pi-chat-run-types.js';
import { renderPiChatQueuedPrompts } from './PiChatQueuedPrompts.js';
import { PiChatMessageCopy } from './PiChatMessageCopy.js';
import { renderPiChatFileMarkdown } from './PiChatFileLinks.js';
import { renderPiChatTool } from './PiChatToolMessage.js';

/** Conversation body; saved and live assistant events group into Pi-style turns. */
export function renderPiChatMessages(container: HTMLElement, history: PiChatSessionHistory, count: number, onLoadEarlier: () => void, onListen: (text: string, button: HTMLButtonElement, response: HTMLElement) => void, markdown: IMarkdownRendererService, copy: PiChatMessageCopy, queued: readonly PiChatQueuedPrompt[], onCancel: (id: string) => void, onSendNow: (id: string) => void, repoPath: string, linkFiles: (element: HTMLElement, disposables: DisposableStore) => void): DisposableStore {
	const disposables = new DisposableStore();
	clearNode(container);
	const messages = history.messages.slice(-count);
	const list = append(container, $('.pi-chat-messages'));
	if (history.messages.length > count) {
		const older = append(list, $('button.pi-chat-load-earlier', {}, 'Load earlier messages'));
		older.addEventListener('click', onLoadEarlier);
	}
	if (!messages.length) {
		const empty = append(list, $('.pi-chat-empty'));
		append(empty, $('h1', {}, localize('piChat.emptyConversation', "New Chat")));
		renderPiChatQueuedPrompts(list, queued, onCancel, onSendNow);
		return disposables;
	}
	let assistantTurn: HTMLElement | undefined;
	for (const message of messages) {
		if (message.role === 'user') {
			assistantTurn = undefined;
			const row = append(list, $('.pi-chat-message-row.pi-chat-user'));
			const bubble = append(row, $('.pi-chat-message-text', {}, message.content));
			const actions = append(bubble, $('.pi-chat-user-actions'));
			const button = copy.renderButton(actions, message.id, message.content);
			bubble.addEventListener('click', () => {
				// A drag-selection finishes with a click; don't copy over the selection.
				if (getWindow(bubble).getSelection()?.isCollapsed !== false) { button.click(); }
			});
			continue;
		}
		if (!assistantTurn) {
			const row = append(list, $('.pi-chat-message-row'));
			assistantTurn = append(row, $('.pi-chat-assistant-turn'));
		}
		renderAssistantMessage(assistantTurn, message, onListen, markdown, copy, disposables, repoPath);
	}
	linkFiles(list, disposables);
	renderPiChatQueuedPrompts(list, queued, onCancel, onSendNow);
	return disposables;
}

function renderAssistantMessage(turn: HTMLElement, message: Exclude<PiChatMessage, { role: 'user' }>, onListen: (text: string, button: HTMLButtonElement, response: HTMLElement) => void, markdown: IMarkdownRendererService, copy: PiChatMessageCopy, disposables: DisposableStore, repoPath: string): void {
	if (message.kind === 'text') {
		const response = append(turn, $('.pi-chat-assistant-response'));
		const text = append(response, $('.pi-chat-assistant-text'));
		const rendered = disposables.add(renderPiChatFileMarkdown(markdown, message.content, repoPath));
		text.appendChild(rendered.element);
		if (message.content.trim()) {
			const actions = append(response, $('.pi-chat-response-actions'));
			const listen = append(actions, $('button.pi-chat-listen', { title: 'Listen to this response' })) as HTMLButtonElement;
			listen.addEventListener('click', () => onListen(message.content, listen, response));
			append(listen, $('span.pi-chat-listen-icon', { 'aria-hidden': 'true' }));
			append(listen, $('span', {}, 'Listen'));
			copy.renderButton(actions, message.id, message.content);
		}
	} else if (message.kind === 'tool') {
		renderPiChatTool(turn, message);
	} else if (message.kind === 'thinking') {
		const details = append(turn, $('details.pi-chat-activity-row'));
		const summary = append(details, $('summary'));
		append(summary, $('.codicon.codicon-lightbulb', { 'aria-hidden': 'true' }));
		append(summary, $('strong', {}, 'Thinking'));
		append(summary, $('span.pi-chat-activity-target', {}, message.content));
		append(details, $('pre.pi-chat-activity-output', {}, message.content));
	} else {
		append(turn, $('.pi-chat-notice' + (message.noticeType === 'warning' ? '.pi-chat-warning' : ''), {}, message.content));
	}
}
