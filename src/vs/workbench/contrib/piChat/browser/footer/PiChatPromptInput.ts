/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { PiChatInputCacheService } from '../PiChatInputCacheService.js';
import { PiChatPromptEditor } from './PiChatPromptEditor.js';

/** Owns only keystrokes, inline references, input history, and crash-safe draft persistence. */
export class PiChatPromptInput extends Disposable {
	readonly input: PiChatPromptEditor;
	private historyIndex = -1;
	private originalDraft = '';
	private submitting = false;
	private dictating = false;

	constructor(parent: HTMLElement, private readonly sessionId: string | undefined, private readonly cache: PiChatInputCacheService, private readonly onSend: (text: string) => Promise<void>, private readonly onChange: () => void) {
		super();
		this.input = this._register(new PiChatPromptEditor(parent, !sessionId, sessionId ? localize('piChat.messagePlaceholder', "Type here...") : localize('piChat.chooseConversation', "Select a conversation or start a new chat...")));
		this.input.value = sessionId ? cache.getDraft(sessionId) : '';
		this._register(addDisposableListener(this.input.element, 'input', () => {
			this.historyIndex = -1;
			this.cacheDraft();
			this.onChange();
		}));
		this._register(addDisposableListener(this.input.element, 'keydown', event => {
			if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
				event.preventDefault();
				this.submit();
			} else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
				this.navigate(event);
			}
		}));
	}

	insertFiles(resources: readonly URI[]): void {
		this.input.insertFiles(resources);
		this.historyIndex = -1;
		this.cacheDraft();
		this.onChange();
	}

	get canSend(): boolean { return !!this.sessionId && !this.submitting && !this.dictating && !!this.input.value.trim(); }

	setDictating(dictating: boolean): void { this.dictating = dictating; this.onChange(); }

	/** Replace only the span owned by the active dictation, preserving the rest of the draft. */
	replaceDictation(start: number, length: number, text: string): void {
		this.input.setRangeText(text, start, start + length, 'end');
		this.historyIndex = -1;
		this.cacheDraft();
		this.onChange();
	}

	submit(): void {
		if (!this.canSend) { return; }
		const text = this.input.value.trim();
		this.submitting = true;
		this.onChange();
		void this.onSend(text).then(() => {
			this.cache.recordSent(text);
			// Do not erase a new draft typed while the command was being accepted.
			if (this.input.value.trim() === text) { this.input.value = ''; this.cacheDraft(); }
			this.historyIndex = -1;
		}, () => {}).finally(() => { this.submitting = false; this.onChange(); });
	}

	restore(text: string): void {
		this.input.value = `${this.input.value}${this.input.value && !this.input.value.endsWith('\n') ? '\n' : ''}${text}`;
		this.historyIndex = -1;
		this.cacheDraft();
		this.onChange();
		this.input.focus();
	}

	private cacheDraft(): void {
		if (this.sessionId) { this.cache.setDraft(this.sessionId, this.input.value); }
	}

	private navigate(event: KeyboardEvent): void {
		const up = event.key === 'ArrowUp';
		const before = this.input.value.slice(0, this.input.selectionStart);
		const after = this.input.value.slice(this.input.selectionEnd);
		if (up ? (before.includes('\n') || (this.historyIndex < 0 && this.input.selectionStart > 0)) : after.includes('\n')) { return; }
		const recent = this.cache.getRecent();
		if (!recent.length || (!up && this.historyIndex < 0)) { return; }
		if (up && this.historyIndex < 0) { this.originalDraft = this.input.value; }
		const next = this.historyIndex + (up ? 1 : -1);
		if (next >= recent.length) { return; }
		this.historyIndex = next;
		this.input.value = next < 0 ? this.originalDraft : recent[next];
		this.input.setSelectionRange(this.input.value.length, this.input.value.length);
		this.cacheDraft();
		this.onChange();
		event.preventDefault();
	}
}
