/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, getWindow } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { MarkdownString, resolveWithBaseUri } from '../../../../../base/common/htmlContent.js';
import { URI } from '../../../../../base/common/uri.js';
import { IMarkdownRenderer } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ITextResourceEditorInput } from '../../../../../platform/editor/common/editor.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { PiChatFileLinkService } from '../PiChatFileLinkService.js';
import { renderPiChatImagePreview } from './PiChatImagePreview.js';

/** Use the shared renderer's repo base URI without losing bare filenames needed for unique-match lookup. */
export function renderPiChatFileMarkdown(markdown: IMarkdownRenderer, content: string, repoPath: string) {
	const value = new MarkdownString(content);
	value.baseUri = URI.file(repoPath.replace(/\/$/, '') + '/');
	const targets = new Map<string, string[]>();
	const rendered = markdown.render(value, { transformUri: (href, kind) => {
		if (kind === 'link') {
			const resolved = resolveWithBaseUri(value.baseUri!, href);
			const references = targets.get(resolved) ?? [];
			references.push(href);
			targets.set(resolved, references);
		}
		return href;
	} });
	// The shared Markdown renderer owns these anchors; construction refs are not available here.
	// eslint-disable-next-line no-restricted-syntax
	for (const anchor of rendered.element.querySelectorAll<HTMLAnchorElement>('a[data-href]')) {
		const target = targets.get(anchor.getAttribute('data-href')!)?.shift();
		if (target !== undefined) { anchor.setAttribute('data-href', target); }
	}
	return rendered;
}

/** Decorates rendered prose/inline code and tool targets, preserving Markdown and fenced code. */
export function decoratePiChatFileLinks(root: HTMLElement, repoPath: string, links: PiChatFileLinkService, hover: IHoverService, disposables: DisposableStore): void {
	let disposed = false;
	disposables.add(toDisposable(() => { disposed = true; }));
	const document = root.ownerDocument;
	const connect = (anchor: HTMLAnchorElement, input: ITextResourceEditorInput) => {
		anchor.classList.add('pi-chat-file-link');
		anchor.href = input.resource.toString();
		disposables.add(hover.setupManagedHover(getDefaultHoverDelegate('mouse'), anchor, input.resource.fsPath));
		disposables.add(addDisposableListener(anchor, 'click', event => {
			event.preventDefault();
			event.stopPropagation(); // Do not toggle tool disclosures or invoke Markdown's link handler as well.
			void links.open(input);
		}));
		if (!anchor.classList.contains('pi-chat-image-preview')) {
			// Prose links may still be in a detached fragment until this resolution callback returns.
			queueMicrotask(() => {
				if (disposed || !root.contains(anchor)) { return; }
				if (anchor.closest('.pi-chat-assistant-text')) { renderPiChatImagePreview(anchor, input, connect, disposables); }
			});
		}
	};
	// Markdown links already carry the exact target. Missing/ambiguous file links become plain text.
	// eslint-disable-next-line no-restricted-syntax
	for (const anchor of root.querySelectorAll<HTMLAnchorElement>('.pi-chat-assistant-text a[data-href]')) {
		const reference = anchor.getAttribute('data-href')!;
		if (!links.isFileReference(reference)) { continue; }
		anchor.removeAttribute('data-href');
		anchor.removeAttribute('href');
		void links.resolve(reference, repoPath).then(input => {
			if (disposed) { return; }
			if (input) { connect(anchor, input); }
			else { anchor.replaceWith(...anchor.childNodes); }
		});
	}
	const walker = document.createTreeWalker(root, getWindow(root).NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	while (walker.nextNode()) {
		const node = walker.currentNode as Text;
		const parent = node.parentElement;
		if (parent?.closest('.pi-chat-assistant-text, [data-pi-file-path]') && !parent.closest('a, button, pre, script, style')) { nodes.push(node); }
	}
	for (const node of nodes) {
		const text = node.data;
		// An inline-code span or a file tool target can contain spaces/brackets in the filename.
		const toolPath = !!node.parentElement?.closest('[data-pi-file-path]');
		const wholePath = toolPath || !!node.parentElement?.closest('code');
		const candidates = wholePath ? [{ text, index: 0 }] : Array.from(text.matchAll(/[^\s`<>"'(){}\[\],;!?]+/gu), match => ({ text: match[0].replace(/[.:]+$/, ''), index: match.index }));
		const pending = candidates.filter(candidate => (wholePath || /[\\/]|\.[^./\\\s]+/.test(candidate.text)) && links.isFileReference(candidate.text)).map(async candidate => {
			const [input, label] = await Promise.all([
				links.resolve(candidate.text, repoPath),
				toolPath ? links.getToolPathLabel(candidate.text, repoPath) : candidate.text,
			]);
			return { ...candidate, input, label };
		});
		if (!pending.length) { continue; }
		void Promise.all(pending).then(matches => {
			if (disposed || !node.parentNode) { return; }
			const fragment = document.createDocumentFragment();
			let offset = 0;
			for (const match of matches) {
				if (!match.input && match.label === match.text) { continue; }
				fragment.append(text.slice(offset, match.index));
				if (match.input) {
					const anchor = document.createElement('a');
					anchor.textContent = match.label;
					connect(anchor, match.input);
					fragment.append(anchor);
				} else {
					fragment.append(match.label);
				}
				offset = match.index + match.text.length;
			}
			if (offset) { fragment.append(text.slice(offset)); node.replaceWith(fragment); }
		});
	}
}
