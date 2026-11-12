/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, append } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { PiChatBodyScroll } from '../../browser/body/PiChatBodyScroll.js';

suite('PiChatBodyScroll Editor Visibility', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let shell: HTMLElement;
	let body: HTMLElement;
	let content: HTMLElement;
	let scroll: PiChatBodyScroll;

	const frame = () => new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));
	const hideEditor = () => {
		scroll.setVisible(false);
		shell.remove();
		shell.style.display = 'none';
		body.dispatchEvent(new mainWindow.Event('scroll'));
	};
	const showEditor = () => {
		mainWindow.document.body.appendChild(shell);
		shell.style.display = '';
		scroll.setVisible(true);
	};

	setup(() => {
		shell = append(mainWindow.document.body, $('div'));
		store.add(toDisposable(() => shell.remove()));
		body = append(shell, $('div', { style: 'height:100px;width:300px;overflow:auto' }));
		content = append(body, $('div', { style: 'height:1200px' }));
		scroll = store.add(new PiChatBodyScroll(shell, body));
	});

	test('keeps the latest message visible through repeated file/chat editor tab switches', async () => {
		scroll.afterRender(true, 0);
		await frame();
		for (let index = 0; index < 3; index++) {
			hideEditor();
			assert.strictEqual(body.scrollTop, 0);
			showEditor();
			await frame();
			assert.deepStrictEqual({ top: body.scrollTop, following: scroll.shouldFollow, jumpHidden: shell.querySelector<HTMLButtonElement>('button')?.hidden }, {
				top: body.scrollHeight - body.clientHeight, following: true, jumpHidden: true,
			});
		}
	});

	test('preserves a manually chosen reading position instead of forcing the chat to the bottom', async () => {
		body.scrollTop = 240;
		body.dispatchEvent(new mainWindow.Event('scroll'));
		for (let index = 0; index < 3; index++) {
			hideEditor();
			assert.strictEqual(scroll.shouldFollow, false);
			showEditor();
			await frame();
			assert.deepStrictEqual({ top: body.scrollTop, following: scroll.shouldFollow, jumpHidden: shell.querySelector<HTMLButtonElement>('button')?.hidden }, {
				top: 240, following: false, jumpHidden: false,
			});
		}
	});

	test('keeps the saved reading position when hidden streaming rerenders report scrollTop zero', async () => {
		body.scrollTop = 320;
		body.dispatchEvent(new mainWindow.Event('scroll'));
		hideEditor();
		content.style.height = '1800px';
		scroll.afterRender(scroll.shouldFollow, body.scrollTop);
		showEditor();
		await frame();
		assert.deepStrictEqual({ top: body.scrollTop, following: scroll.shouldFollow }, { top: 320, following: false });
	});

	test('follows new messages received while hidden if the reader was already at the bottom', async () => {
		scroll.afterRender(true, 0);
		hideEditor(); // Also invalidates the pending visible-render animation frame.
		content.style.height = '2000px';
		scroll.afterRender(scroll.shouldFollow, 0);
		await frame();
		assert.strictEqual(body.scrollTop, 0);
		showEditor();
		await frame();
		assert.deepStrictEqual({ top: body.scrollTop, following: scroll.shouldFollow }, { top: 1900, following: true });
	});
});
