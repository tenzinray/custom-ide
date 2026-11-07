/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { PiChatSessionSummary } from '../../common/pi-chat-types.js';

/** Pi UI composer presentation. Sending and dictation are deliberately disabled until runtime integration. */
export function renderPiChatFooter(footer: HTMLElement, summary: PiChatSessionSummary | undefined, modelName: string | undefined, models: readonly string[], onSelectModel: (model: string) => void): void {
	clearNode(footer);
	const composer = append(footer, $('.pi-chat-composer'));
	append(composer, $('textarea', { 'aria-label': 'Message', placeholder: summary ? 'Message Pi...' : 'Select a conversation or start a new chat...', rows: '2', disabled: 'true' }));
	const controls = append(composer, $('.pi-chat-composer-controls'));
	if (modelName) {
		const model = append(controls, $('label.pi-chat-model'));
		append(model, $('span.pi-chat-sr-only', {}, 'Model for this chat'));
		const select = append(model, $('select', { 'aria-label': 'Model for this chat', title: 'Choose a model (sending is not available yet)' })) as HTMLSelectElement;
		for (const name of [modelName, ...models.filter(name => name !== modelName)]) {
			append(select, $('option', { value: name }, name));
		}
		select.value = modelName;
		select.addEventListener('change', () => onSelectModel(select.value));
		append(model, $('span.codicon.codicon-chevron-down', { 'aria-hidden': 'true' }));
	}
	const actions = append(controls, $('.pi-chat-composer-actions'));
	append(actions, $('button.pi-chat-dictation.codicon.codicon-mic', { 'aria-label': 'Start dictation', disabled: 'true', title: 'Dictation is not available yet' }));
	append(actions, $('button.pi-chat-send.codicon.codicon-arrow-up', { 'aria-label': 'Send message', disabled: 'true', title: 'Sending messages is not available yet' }));
	const note = append(footer, $('.pi-chat-composer-note'));
	if (summary) {
		const slash = summary.repoPath.lastIndexOf('/');
		append(note, $('span', {}, summary.repoPath.slice(0, slash + 1)));
		append(note, $('strong', {}, summary.repoPath.slice(slash + 1)));
	} else { note.textContent = 'Select a conversation or start a new chat.'; }
}
