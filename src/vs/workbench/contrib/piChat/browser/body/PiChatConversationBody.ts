/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, getWindow } from '../../../../../base/browser/dom.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { PiChatMessage, PiChatSessionHistory } from '../../common/pi-chat-types.js';
import { renderPiChatTool } from './PiChatToolMessage.js';

/** Read-only conversation body; saved assistant events group into Pi UI-style turns. */
export function renderPiChatMessages(container: HTMLElement, history: PiChatSessionHistory, count: number, onLoadEarlier: () => void, onListen: (text: string, button: HTMLButtonElement, response: HTMLElement) => void, markdown: IMarkdownRendererService, scrollToLatest: boolean): DisposableStore {
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
		append(empty, $('h1', {}, 'A fresh conversation.'));
		append(empty, $('p', {}, 'Choose a model below. Sending messages is not available yet.'));
		return disposables;
	}
	let assistantTurn: HTMLElement | undefined;
	for (const message of messages) {
		if (message.role === 'user') {
			assistantTurn = undefined;
			const row = append(list, $('.pi-chat-message-row.pi-chat-user'));
			append(row, $('.pi-chat-message-text', {}, message.content));
			continue;
		}
		if (!assistantTurn) {
			const row = append(list, $('.pi-chat-message-row'));
			assistantTurn = append(row, $('.pi-chat-assistant-turn'));
		}
		renderAssistantMessage(assistantTurn, message, onListen, markdown, disposables);
	}
	if (scrollToLatest) {
		getWindow(container).requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
	}
	return disposables;
}

function renderAssistantMessage(turn: HTMLElement, message: Exclude<PiChatMessage, { role: 'user' }>, onListen: (text: string, button: HTMLButtonElement, response: HTMLElement) => void, markdown: IMarkdownRendererService, disposables: DisposableStore): void {
	if (message.kind === 'text') {
		const response = append(turn, $('.pi-chat-assistant-response'));
		const text = append(response, $('.pi-chat-assistant-text'));
		const rendered = disposables.add(markdown.render(new MarkdownString(message.content)));
		text.appendChild(rendered.element);
		if (message.content.trim()) {
			const listen = append(response, $('button.pi-chat-listen', { title: 'Listen to this response' })) as HTMLButtonElement;
			listen.addEventListener('click', () => onListen(message.content, listen, response));
			append(listen, $('span.pi-chat-listen-icon', { 'aria-hidden': 'true' }));
			append(listen, $('span', {}, 'Listen'));
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
