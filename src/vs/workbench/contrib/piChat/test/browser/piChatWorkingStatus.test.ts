/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, append } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { PiChatWorkingStatus } from '../../browser/body/PiChatWorkingStatus.js';
import { PiChatTurnStatusBar } from '../../browser/footer/PiChatTurnStatusBar.js';
import '../../browser/media/piChat.css';

suite('PiChatWorkingStatus', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let conversation: HTMLElement;
	let body: HTMLElement;
	let messages: HTMLElement;
	let message: HTMLElement;
	let status: PiChatWorkingStatus;
	let footer: HTMLElement;
	let statusHost: HTMLElement;

	setup(() => {
		conversation = append(mainWindow.document.body, $('.pi-chat-conversation', { style: 'height:600px;width:790px;--vscode-charts-yellow:rgb(255, 200, 0)' }));
		store.add(toDisposable(() => conversation.remove()));
		const shell = append(conversation, $('.pi-chat-conversation-body-shell'));
		body = append(shell, $('.pi-chat-conversation-body'));
		messages = append(body, $('.pi-chat-messages'));
		message = append(messages, $('div', { style: 'flex:0 0 1200px' }, 'Response'));
		status = new PiChatWorkingStatus();
		append(messages, status.element);
		footer = append(conversation, $('footer.pi-chat-conversation-footer'));
		statusHost = append(footer, $('.pi-chat-turn-status-host'));
		append(footer, $('.pi-chat-composer', { style: 'height:100px' }));
	});

	test('shows working and yellow compaction, then clears on completion without changing transcript geometry', () => {
		const geometry = () => ({ height: body.scrollHeight, messageTop: message.offsetTop, slotHeight: status.element.getBoundingClientRect().height });
		const initial = geometry();
		const states = [];
		for (const [working, compacting] of [[true, false], [true, true], [true, false], [false, false]]) {
			status.setState(working, compacting);
			states.push({ text: status.element.textContent, visibility: status.element.style.visibility, compacting: status.element.classList.contains('pi-chat-compacting'), geometry: geometry() });
			if (compacting) { assert.strictEqual(mainWindow.getComputedStyle(status.element).color, 'rgb(255, 200, 0)'); }
		}
		assert.deepStrictEqual(states, [
			{ text: 'Working…', visibility: 'visible', compacting: false, geometry: initial },
			{ text: 'Compacting…', visibility: 'visible', compacting: true, geometry: initial },
			{ text: 'Working…', visibility: 'visible', compacting: false, geometry: initial },
			{ text: '', visibility: 'hidden', compacting: false, geometry: initial },
		]);
	});

	for (const width of [790, 320]) {
		test(`timer floats over scrolling messages without shifting layout at ${width}px`, () => {
			conversation.style.width = `${width}px`;
			status.setState(true, false);
			body.scrollTop = body.scrollHeight;
			const geometry = () => ({ bodyHeight: body.clientHeight, scrollHeight: body.scrollHeight, scrollTop: body.scrollTop, footerTop: footer.getBoundingClientRect().top });
			const initial = geometry();
			const bar = store.add(new PiChatTurnStatusBar(statusHost, async () => { }));
			assert.deepStrictEqual(geometry(), initial);
			const barBounds = statusHost.getBoundingClientRect();
			assert.ok(barBounds.top < body.getBoundingClientRect().bottom);
			assert.ok(status.element.getBoundingClientRect().bottom <= barBounds.top, 'bottom clearance keeps activity above the timer');
			const statusTop = status.element.getBoundingClientRect().top;
			body.scrollTop -= 150;
			assert.deepStrictEqual({ barTop: statusHost.getBoundingClientRect().top, statusTop: status.element.getBoundingClientRect().top }, { barTop: barBounds.top, statusTop: statusTop + 150 });
			const scrolled = geometry();
			bar.dispose();
			status.setState(false, false);
			assert.deepStrictEqual(geometry(), scrolled);
		});
	}
});
