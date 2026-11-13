/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, getWindow } from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { remoteDatabasePermissionPhrase } from '../../common/piChatQuickPhrases.js';

/** Transcript actions only insert draft text; they never send or grant database access themselves. */
export function decoratePiChatPermissionLinks(root: HTMLElement, onInsert: (text: string) => void, disposables: DisposableStore): void {
	// eslint-disable-next-line no-restricted-syntax
	for (const response of root.querySelectorAll<HTMLElement>('.pi-chat-assistant-text')) {
		const walker = response.ownerDocument.createTreeWalker(response, getWindow(response).NodeFilter.SHOW_TEXT);
		const nodes: { node: Text; start: number; end: number }[] = [];
		let text = '';
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			// Keep code blocks and existing links inert, and prevent matching across them.
			if (node.parentElement?.closest('pre, a, button, script, style')) { text += '\0'; continue; }
			const start = text.length;
			text += node.data;
			nodes.push({ node, start, end: text.length });
		}
		// Work backwards so earlier offsets stay valid, including multiple matches in one node.
		for (let offset = text.lastIndexOf(remoteDatabasePermissionPhrase); offset >= 0; offset = text.lastIndexOf(remoteDatabasePermissionPhrase, offset - 1)) {
			const end = offset + remoteDatabasePermissionPhrase.length;
			const from = nodes.find(entry => entry.start <= offset && entry.end > offset)!;
			const to = nodes.find(entry => entry.start < end && entry.end >= end)!;
			const range = response.ownerDocument.createRange();
			range.setStart(from.node, offset - from.start);
			range.setEnd(to.node, end - to.start);
			const button = $('button.pi-chat-permission-link', { type: 'button', 'aria-label': localize('piChat.insertDatabasePermission', "Add database permission sentence to this chat's input") }, remoteDatabasePermissionPhrase);
			disposables.add(addDisposableListener(button, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				onInsert(remoteDatabasePermissionPhrase);
			}));
			range.deleteContents();
			range.insertNode(button);
			if (offset === 0) { break; }
		}
	}
}
