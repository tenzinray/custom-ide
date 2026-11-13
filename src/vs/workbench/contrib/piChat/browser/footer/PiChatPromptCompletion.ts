/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow } from '../../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { localize } from '../../../../../nls.js';
import { piChatQuickPhrases } from '../../common/piChatQuickPhrases.js';
import { PiChatPromptEditor } from './PiChatPromptEditor.js';

/** Local, draft-only phrase suggestions; no permanent controls or slash-command handling. */
export class PiChatPromptCompletion extends Disposable {
	private readonly hint: HTMLElement;
	private dismissedValue: string | undefined;
	private composing = false;
	private suggestion: { start: number; end: number; text: string } | undefined;

	constructor(private readonly editor: PiChatPromptEditor, private readonly enabled: () => boolean, private readonly onAccept: () => void) {
		super();
		this.hint = append(editor.element.parentElement!, $('span.pi-chat-prompt-completion', { id: generateUuid(), role: 'status', 'aria-live': 'polite' }));
		this.hint.hidden = true;
		editor.element.setAttribute('aria-autocomplete', 'inline');
		this._register(toDisposable(() => {
			this.hint.remove();
			editor.element.removeAttribute('aria-describedby');
			editor.element.removeAttribute('aria-autocomplete');
		}));
		for (const type of ['input', 'focus', 'blur', 'scroll']) {
			this._register(addDisposableListener(editor.element, type, () => this.refresh()));
		}
		this._register(addDisposableListener(editor.element.ownerDocument, 'selectionchange', () => this.refresh()));
		this._register(addDisposableListener(editor.element, 'compositionstart', () => { this.composing = true; this.refresh(); }));
		this._register(addDisposableListener(editor.element, 'compositionend', () => { this.composing = false; this.refresh(); }));
		this._register(addDisposableListener(editor.element, 'keydown', event => {
			if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) { return; }
			this.refresh();
			if (!this.suggestion || (event.key !== 'Tab' && event.key !== 'Escape')) { return; }
			event.preventDefault();
			event.stopImmediatePropagation();
			if (event.key === 'Escape') {
				this.dismissedValue = editor.value;
			} else {
				const { text, start, end } = this.suggestion;
				editor.setRangeText(text, start, end, 'end');
				this.onAccept();
			}
			this.refresh();
		}, true));
	}

	refresh(): void {
		const { editor } = this;
		this.suggestion = undefined;
		this.hint.hidden = true;
		editor.element.removeAttribute('aria-describedby');
		const value = editor.value;
		if (this.dismissedValue !== value) { this.dismissedValue = undefined; }
		if (editor.disabled || !this.enabled() || this.composing || this.dismissedValue === value || editor.element.ownerDocument.activeElement !== editor.element || editor.selectionStart !== value.length || editor.selectionEnd !== value.length) { return; }
		const lineStart = value.lastIndexOf('\n') + 1;
		const prefix = value.slice(lineStart);
		const phrase = piChatQuickPhrases.find(phrase => prefix.startsWith(phrase.trigger) && phrase.text !== prefix && (phrase.text.startsWith(prefix) || prefix === phrase.trigger));
		if (!phrase) { return; }
		const selection = getWindow(editor.element).getSelection();
		if (!selection?.rangeCount) { return; }
		const range = selection.getRangeAt(0).cloneRange();
		range.collapse(false);
		const caret = range.getBoundingClientRect();
		const host = this.hint.parentElement!.getBoundingClientRect();
		const viewport = editor.element.getBoundingClientRect();
		if (!caret.height || caret.top < viewport.top || caret.bottom > viewport.bottom) { return; }
		this.suggestion = { start: lineStart, end: value.length, text: phrase.text };
		const remaining = phrase.text.startsWith(prefix) ? phrase.text.slice(prefix.length) : ` → ${phrase.text}`;
		this.hint.textContent = localize('piChat.quickPhraseHint', "{0}  ⇥ Tab", remaining);
		this.hint.setAttribute('aria-label', localize('piChat.quickPhraseAccessibleHint', "{0}. Press Tab to insert, or Escape to dismiss.", phrase.text));
		this.hint.style.left = `${caret.left - host.left}px`;
		this.hint.style.top = `${caret.top - host.top}px`;
		this.hint.hidden = false;
		editor.element.setAttribute('aria-describedby', this.hint.id);
	}
}
