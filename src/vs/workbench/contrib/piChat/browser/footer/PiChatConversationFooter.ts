/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { IDisposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { PiChatSessionSummary } from '../../common/pi-chat-types.js';
import { PiChatInputCacheService } from '../PiChatInputCacheService.js';
import { PiChatPromptInput } from './PiChatPromptInput.js';
import { PiChatTurnStatusBar } from './PiChatTurnStatusBar.js';

export interface PiChatFooterControls extends IDisposable {
	setBusy(busy: boolean): void;
	recordEvent(): void;
	restore(text: string): void;
}

/** Composer presentation and local draft state; the conversation pane owns sending. */
export function renderPiChatFooter(footer: HTMLElement, summary: PiChatSessionSummary | undefined, modelName: string | undefined, models: readonly string[], cache: PiChatInputCacheService, onSelectModel: (model: string) => void, onSend: (text: string) => Promise<void>, onStop: () => Promise<void>): PiChatFooterControls {
	clearNode(footer);
	const statusBar = new MutableDisposable<PiChatTurnStatusBar>();
	const statusHost = append(footer, $('.pi-chat-turn-status-host'));
	const composer = append(footer, $('.pi-chat-composer'));
	const promptInput = new PiChatPromptInput(composer, summary?.id, cache, onSend, () => update());
	const controls = append(composer, $('.pi-chat-composer-controls'));
	if (modelName) {
		const model = append(controls, $('label.pi-chat-model'));
		append(model, $('span.pi-chat-sr-only', {}, localize('piChat.modelLabel', "Model for this chat")));
		const select = append(model, $('select', { 'aria-label': localize('piChat.modelLabel', "Model for this chat"), title: localize('piChat.chooseModel', "Choose a model") })) as HTMLSelectElement;
		for (const name of [modelName, ...models.filter(name => name !== modelName)]) {
			append(select, $('option', { value: name }, name));
		}
		select.value = modelName;
		select.addEventListener('change', () => onSelectModel(select.value));
		append(model, $('span.codicon.codicon-chevron-down', { 'aria-hidden': 'true' }));
	}
	const actions = append(controls, $('.pi-chat-composer-actions'));
	append(actions, $('button.pi-chat-dictation.codicon.codicon-mic', { 'aria-label': localize('piChat.dictation', "Start dictation"), disabled: 'true', title: localize('piChat.dictationUnavailable', "Dictation is not available yet") }));
	const send = append(actions, $('button.pi-chat-send.codicon.codicon-arrow-up', { 'aria-label': localize('piChat.send', "Send message"), title: localize('piChat.send', "Send message") })) as HTMLButtonElement;
	const note = append(footer, $('.pi-chat-composer-note'));
	if (summary) {
		const slash = summary.repoPath.lastIndexOf('/');
		append(note, $('span', {}, summary.repoPath.slice(0, slash + 1)));
		append(note, $('strong', {}, summary.repoPath.slice(slash + 1)));
	} else { note.textContent = localize('piChat.chooseConversation', "Select a conversation or start a new chat..."); }
	let busy = false;
	const update = () => { send.disabled = !promptInput.canSend; };
	const setBusy = (value: boolean) => {
		if (busy === value) { return; }
		busy = value;
		if (busy) { statusBar.value = new PiChatTurnStatusBar(statusHost, onStop); }
		else { statusBar.clear(); }
		update();
	};
	send.addEventListener('click', () => promptInput.submit());
	update();
	return { setBusy, recordEvent: () => statusBar.value?.recordEvent(), restore: text => promptInput.restore(text), dispose: () => statusBar.dispose() };
}
