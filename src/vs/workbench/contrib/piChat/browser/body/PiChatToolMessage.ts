/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { getPiChatSpeakText } from '../../common/piChatSpeakCommand.js';
import { PiChatMessage } from '../../common/pi-chat-types.js';

const appearance: Record<string, [string, string]> = {
	read: ['Read', 'book'], bash: ['Command', 'terminal'], edit: ['Edited', 'edit'], write: ['Created', 'new-file'],
	grep: ['Search', 'search'], find: ['Search', 'search'], ls: ['Search', 'search'],
	web_search: ['Web', 'globe'], fetch_content: ['Web', 'globe'],
};

/** Saved tool rows use Pi UI's labels and compact result indicators. */
export function renderPiChatTool(turn: HTMLElement, message: Extract<PiChatMessage, { kind: 'tool' }>): void {
	const spoken = message.toolName === 'bash' ? getPiChatSpeakText(message.input) : undefined;
	const [label, icon] = appearance[message.toolName] ?? [message.toolName, 'tools'];
	const details = !!message.output || spoken !== undefined;
	const row = append(turn, $(details ? 'details.pi-chat-activity-row' : 'div.pi-chat-activity-row'));
	const summary = append(row, $(details ? 'summary' : 'div.pi-chat-tool-summary'));
	if (spoken !== undefined) {
		const button = append(summary, $('button.pi-chat-speak-icon', { type: 'button', 'data-pi-speak-text': spoken, 'data-pi-speak-id': `speak:${message.id}`, 'data-pi-speak-live': String(message.state === 'running'), 'aria-label': localize('piChat.replaySpeech', "Replay speech"), 'aria-pressed': 'false' }));
		append(button, $('span.codicon.codicon-unmute', { 'aria-hidden': 'true' }));
	} else { append(summary, $(`span.codicon.codicon-${icon}`, { 'aria-hidden': 'true' })); }
	append(summary, $('strong', {}, spoken !== undefined ? localize('piChat.speak', "Speak") : label));
	const text = spoken ?? message.input;
	const target = append(summary, $('span.pi-chat-activity-target', { title: text }, text));
	if (message.toolName === 'read' || message.toolName === 'edit' || message.toolName === 'write') { target.setAttribute('data-pi-file-path', ''); }
	const stateIcon = message.state === 'failed' ? 'error' : message.state === 'running' ? 'loading' : 'check';
	append(summary, $(`span.pi-chat-activity-state.codicon.codicon-${stateIcon}`, { title: message.state, 'aria-label': message.state }));
	if (spoken !== undefined || message.output) { append(row, $('pre.pi-chat-activity-output', {}, spoken ?? message.output ?? '')); }
}
