/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, append } from '../../../../../base/browser/dom.js';
import { Direction } from '../../../../../base/browser/ui/grid/grid.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { fillPiChatDragData, PiChatGroupDropTarget } from '../../browser/PiChatGroupDropTarget.js';
import { PiChatSessionOpenOptions } from '../../browser/PiChatSelectionService.js';

suite('Pi chat drop targets', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const instantiation = upcastPartial<IInstantiationService>({ invokeFunction: <R>() => undefined as R });

	function host(): HTMLElement {
		const element = append(mainWindow.document.body, $('div', { style: 'width:400px;height:200px;position:fixed;left:0;top:0' }));
		store.add(toDisposable(() => element.remove()));
		return element;
	}

	function drag(element: HTMLElement, type: string, x = 0.5, y = 0.5): void {
		const rect = element.getBoundingClientRect();
		const event = new mainWindow.DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: new mainWindow.DataTransfer(), clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y });
		fillPiChatDragData(instantiation, { id: 'chat', repoName: 'project', repoPath: '/project', sessionFile: URI.file('/chat.jsonl'), lastMessageAt: '2026-01-01' }, event, 0);
		element.dispatchEvent(event);
	}

	test('only left and right edges split; top and bottom center merge', () => {
		const element = host();
		const directions: PiChatSessionOpenOptions['direction'][] = [];
		store.add(new PiChatGroupDropTarget(element, (_id, _source, direction) => directions.push(direction)));
		for (const [x, y] of [[0.05, 0.5], [0.95, 0.5], [0.5, 0.01], [0.5, 0.99]]) { drag(element, 'drop', x, y); }
		assert.deepStrictEqual(directions, [Direction.Left, Direction.Right, undefined, undefined]);
	});

	test('dropping onto any part of a tab strip always merges', () => {
		const element = host();
		const directions: PiChatSessionOpenOptions['direction'][] = [];
		store.add(new PiChatGroupDropTarget(element, (_id, _source, direction) => directions.push(direction), true));
		drag(element, 'drop', 0.01, 0.01);
		drag(element, 'drop', 0.99, 0.99);
		assert.deepStrictEqual(directions, [undefined, undefined]);
	});

	test('moving across panes transfers the preview before drop even when dragleave is missed', () => {
		const source = host();
		const destination = host();
		store.add(new PiChatGroupDropTarget(source, () => { }));
		store.add(new PiChatGroupDropTarget(destination, () => { }));
		drag(source, 'dragover', 0.9);
		const before = [source.dataset.chatDrop, destination.dataset.chatDrop];
		drag(destination, 'dragover', 0.5);
		assert.deepStrictEqual({ before, after: [source.dataset.chatDrop, destination.dataset.chatDrop] }, { before: ['right', undefined], after: [undefined, 'center'] });
	});

	test('moving from a pane body into a tab strip replaces the body preview with strip feedback', () => {
		const pane = host();
		const strip = append(pane, $('div', { style: 'width:200px;height:35px' }));
		store.add(new PiChatGroupDropTarget(pane, () => { }));
		store.add(new PiChatGroupDropTarget(strip, () => { }, true));
		drag(pane, 'dragover', 0.9);
		drag(strip, 'dragover');
		assert.deepStrictEqual([pane.dataset.chatDrop, strip.dataset.chatDrop], [undefined, 'center']);
	});

	test('leaving chat panes for another workbench surface clears the previous preview', () => {
		const pane = host();
		const elsewhere = host();
		store.add(new PiChatGroupDropTarget(pane, () => { }));
		drag(pane, 'dragover', 0.9);
		drag(elsewhere, 'dragover');
		assert.strictEqual(pane.dataset.chatDrop, undefined);
	});

	test('a captured drop clears every preview even when dragend never arrives', () => {
		const first = host();
		const second = host();
		store.add(new PiChatGroupDropTarget(first, () => { }));
		store.add(new PiChatGroupDropTarget(second, () => { }));
		drag(first, 'dragover', 0.1);
		drag(second, 'dragover', 0.9);
		// Simulate stale feedback left by an earlier drag before the source DOM changed.
		first.dataset.chatDrop = 'left';
		const before = [first.dataset.chatDrop, second.dataset.chatDrop];
		drag(second, 'drop', 0.9);
		assert.deepStrictEqual({ before, after: [first.dataset.chatDrop, second.dataset.chatDrop] }, { before: ['left', 'right'], after: [undefined, undefined] });
	});

	test('Escape and disposal clear cancelled drag feedback', () => {
		const element = host();
		const target = store.add(new PiChatGroupDropTarget(element, () => { }));
		drag(element, 'dragover');
		mainWindow.document.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		const escaped = element.dataset.chatDrop;
		drag(element, 'dragover');
		target.dispose();
		assert.deepStrictEqual([escaped, element.dataset.chatDrop], [undefined, undefined]);
	});
});
