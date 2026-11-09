/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { PiChatQueuedPrompt } from '../../common/pi-chat-run-types.js';

/** Pending steering prompts remain visible below the conversation until Pi consumes them. */
export function renderPiChatQueuedPrompts(list: HTMLElement, queued: readonly PiChatQueuedPrompt[], onCancel: (id: string) => void, onSendNow: (id: string) => void): void {
	for (const prompt of queued) {
		const row = append(list, $('.pi-chat-queued-prompt'));
		append(row, $('span.pi-chat-queued-label', {}, localize('piChat.queued', "Queued for Pi")));
		append(row, $('.pi-chat-queued-text', {}, prompt.text));
		const actions = append(row, $('.pi-chat-queued-actions'));
		const cancel = append(actions, $('button', { type: 'button' }, localize('piChat.restoreQueued', "Return to Input")));
		cancel.addEventListener('click', () => onCancel(prompt.id));
		const sendNow = append(actions, $('button', { type: 'button' }, localize('piChat.sendNow', "Send Now")));
		sendNow.addEventListener('click', () => onSendNow(prompt.id));
	}
}
