/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow } from '../../../../../base/browser/dom.js';
import { sanitizeHtml } from '../../../../../base/browser/domSanitize.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { basename } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';

/** Inline file references serialize as Markdown links in drafts, history, and Pi prompts. */
export class PiChatPromptEditor extends Disposable {
	readonly element: HTMLElement;
	private readonly placeholder: HTMLElement;
	private replacingText = false;
	private savedSelection: { start: number; end: number } | undefined;

	constructor(parent: HTMLElement, readonly disabled: boolean, placeholder: string) {
		super();
		this.element = append(parent, $('.pi-chat-prompt-editor', { contenteditable: disabled ? 'false' : 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-disabled': String(disabled), 'aria-label': localize('piChat.message', "Message"), 'aria-placeholder': placeholder }));
		// Keep the hint outside the editable DOM so it can never move or become the caret.
		this.placeholder = append(parent, $('span.pi-chat-prompt-placeholder', { 'aria-hidden': 'true' }, placeholder));
		// Like textarea.setRangeText, transcript updates must not look like user typing.
		this._register(addDisposableListener(this.element, 'input', event => {
			this.updatePlaceholder();
			if (this.replacingText) { event.stopImmediatePropagation(); }
		}, true));
		this._register(addDisposableListener(this.element.ownerDocument, 'selectionchange', () => {
			const selection = getWindow(this.element).getSelection();
			if (selection?.rangeCount && this.element.contains(selection.getRangeAt(0).commonAncestorContainer)) {
				this.savedSelection = { start: this.selectionStart, end: this.selectionEnd };
			}
		}));
		this._register(addDisposableListener(this.element, 'paste', event => {
			event.preventDefault();
			this.insertText(event.clipboardData?.getData('text/plain') ?? '');
		}));
		this._register(addDisposableListener(this.element, 'keydown', event => {
			// Like the workbench URL bar, contenteditable must intercept editing shortcuts
			// before global commands redirect them to the most recently focused code editor.
			if ((isMacintosh ? event.metaKey : event.ctrlKey) && !event.altKey) {
				const key = event.key.toLowerCase();
				if ((key === 'a' && !event.shiftKey) || key === 'z' || (!isMacintosh && key === 'y')) {
					event.preventDefault();
					event.stopPropagation();
					if (key === 'a') { this.setSelectionRange(0, this.value.length); }
					else { this.element.ownerDocument.execCommand(key === 'y' || event.shiftKey ? 'redo' : 'undo'); }
					return;
				}
			}
			if (event.key === 'Enter' && event.shiftKey) {
				event.preventDefault();
				this.element.ownerDocument.execCommand('insertLineBreak');
			}
		}));
	}

	get value(): string {
		// Chromium leaves one BR behind when the last character is deleted.
		if (!this.element.textContent && this.element.childElementCount === 1 && this.element.firstElementChild?.tagName === 'BR') { return ''; }
		return this.serialize(this.element);
	}
	set value(text: string) {
		this.savedSelection = undefined;
		this.element.replaceChildren();
		// Restore only our file links; ordinary pasted text is never interpreted as HTML.
		const pattern = /\[([^\n]*?)\]\((file:\/\/\/[^\s)]+|vscode-remote:\/\/[^\s)]+)\)/g;
		let offset = 0;
		for (const match of text.matchAll(pattern)) {
			this.element.append(text.slice(offset, match.index), this.fileChip(URI.parse(match[2])));
			offset = match.index! + match[0].length;
		}
		this.element.append(text.slice(offset));
		this.updatePlaceholder();
		const end = this.value.length;
		this.savedSelection = { start: end, end };
		if (this.element.ownerDocument.activeElement === this.element) { this.setSelectionRange(end, end); }
	}

	get selectionStart(): number { return this.selectionOffset(false); }
	get selectionEnd(): number { return this.selectionOffset(true); }

	focus(): void {
		if (this.element.ownerDocument.activeElement === this.element) { return; }
		const start = this.selectionStart;
		const end = this.selectionEnd;
		this.element.focus();
		this.setSelectionRange(start, end);
	}

	insertFiles(resources: readonly URI[]): void {
		if (this.disabled || !resources.length) { return; }
		const start = this.selectionStart;
		const end = this.selectionEnd;
		this.focus();
		this.setSelectionRange(start, end);
		const fragment = $('span');
		for (const resource of resources) { fragment.append(this.fileChip(resource), ' '); }
		const cursor = start + this.serialize(fragment).length;
		this.insertFragment(fragment);
		this.setSelectionRange(cursor, cursor);
	}

	setRangeText(text: string, start: number, end: number, _selectionMode: 'end'): void {
		this.focus();
		this.setSelectionRange(start, end);
		this.replacingText = true;
		try { this.insertText(text); }
		finally { this.replacingText = false; }
	}

	private updatePlaceholder(): void {
		this.placeholder.hidden = !!this.value;
	}

	private insertText(text: string): void {
		const fragment = $('span');
		for (const [index, line] of text.split(/\r?\n/).entries()) {
			if (index) { fragment.append($('br')); }
			fragment.append(line);
		}
		this.insertFragment(fragment);
	}

	private insertFragment(fragment: HTMLElement): void {
		// Reuse the workbench sanitizer and its CSP-approved Trusted Types policy.
		// Native editing keeps typing, chip insertion, and removal in the same undo stack.
		const html = sanitizeHtml(fragment.innerHTML, { allowedTags: { override: ['span', 'br'] }, allowedAttributes: { override: ['class', 'contenteditable', 'data-file-uri', 'aria-label', 'aria-hidden'] } });
		// lib.dom types predate TrustedHTML support in execCommand.
		this.element.ownerDocument.execCommand('insertHTML', false, html as unknown as string);
	}

	setSelectionRange(start: number, end: number): void {
		const range = this.element.ownerDocument.createRange();
		const from = this.positionAt(start);
		const to = this.positionAt(end);
		range.setStart(from.node, from.offset);
		range.setEnd(to.node, to.offset);
		const selection = getWindow(this.element).getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		this.savedSelection = { start, end };
	}

	private fileChip(resource: URI): HTMLElement {
		const chip = $('span.pi-chat-file-reference', { contenteditable: 'false', 'data-file-uri': resource.toString(), 'aria-label': resource.fsPath });
		append(chip, $('span.codicon.codicon-file', { 'aria-hidden': 'true' }));
		append(chip, $('span', {}, basename(resource)));
		return chip;
	}

	private serialize(node: Node): string {
		if (node.nodeType === node.TEXT_NODE) { return (node.textContent ?? '').replace(/\u00a0/g, ' '); }
		if (node instanceof getWindow(this.element).HTMLElement) {
			const uri = node.dataset.fileUri;
			if (uri) { return `[${basename(URI.parse(uri))}](${uri.replace(/\)/g, '%29')})`; }
			if (node.tagName === 'BR') { return '\n'; }
		}
		return Array.from(node.childNodes, child => this.serialize(child)).join('');
	}

	private selectionOffset(end: boolean): number {
		const selection = getWindow(this.element).getSelection();
		if (!selection?.rangeCount) { return Math.min(this.value.length, (end ? this.savedSelection?.end : this.savedSelection?.start) ?? this.value.length); }
		const selected = selection.getRangeAt(0);
		const node = end ? selected.endContainer : selected.startContainer;
		if (!this.element.contains(node)) { return Math.min(this.value.length, (end ? this.savedSelection?.end : this.savedSelection?.start) ?? this.value.length); }
		const range = this.element.ownerDocument.createRange();
		range.selectNodeContents(this.element);
		range.setEnd(node, end ? selected.endOffset : selected.startOffset);
		return this.serialize(range.cloneContents()).length;
	}

	private positionAt(offset: number): { node: Node; offset: number } {
		const visit = (parent: Node): { node: Node; offset: number } | undefined => {
			for (let index = 0; index < parent.childNodes.length; index++) {
				const child = parent.childNodes[index];
				const length = this.serialize(child).length;
				if (offset <= length) {
					if (child.nodeType === child.TEXT_NODE) { return { node: child, offset }; }
					if (child instanceof getWindow(this.element).HTMLElement && (child.dataset.fileUri || child.tagName === 'BR')) {
						return { node: parent, offset: index + (offset > 0 ? 1 : 0) };
					}
					return visit(child) ?? { node: parent, offset: index };
				}
				offset -= length;
			}
			return undefined;
		};
		return visit(this.element) ?? { node: this.element, offset: this.element.childNodes.length };
	}
}
