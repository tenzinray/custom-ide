/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { PiChatMessage } from '../../common/pi-chat-types.js';

const appearance: Record<string, [string, string]> = {
	read: ['Read', 'book'], bash: ['Command', 'terminal'], edit: ['Edited', 'edit'], write: ['Created', 'new-file'],
	grep: ['Search', 'search'], find: ['Search', 'search'], ls: ['Search', 'search'],
	web_search: ['Web', 'globe'], fetch_content: ['Web', 'globe'],
};

/** Saved tool rows use Pi UI's labels and compact result indicators. */
export function renderPiChatTool(turn: HTMLElement, message: Extract<PiChatMessage, { kind: 'tool' }>): void {
	const [label, icon] = appearance[message.toolName] ?? [message.toolName, 'tools'];
	const row = append(turn, $(message.output ? 'details.pi-chat-activity-row' : 'div.pi-chat-activity-row'));
	const summary = append(row, $(message.output ? 'summary' : 'div.pi-chat-tool-summary'));
	append(summary, $(`span.codicon.codicon-${icon}`, { 'aria-hidden': 'true' }));
	append(summary, $('strong', {}, label));
	append(summary, $('span.pi-chat-activity-target', { title: message.input }, message.input));
	const stateIcon = message.state === 'failed' ? 'error' : message.state === 'running' ? 'loading' : 'check';
	append(summary, $(`span.pi-chat-activity-state.codicon.codicon-${stateIcon}`, { title: message.state, 'aria-label': message.state }));
	if (message.output) { append(row, $('pre.pi-chat-activity-output', {}, message.output)); }
}
