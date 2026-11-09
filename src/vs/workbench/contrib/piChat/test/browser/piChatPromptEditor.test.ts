/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { PiChatInputCacheService } from '../../browser/PiChatInputCacheService.js';
import { PiChatPromptInput } from '../../browser/footer/PiChatPromptInput.js';
import { PiChatPromptEditor } from '../../browser/footer/PiChatPromptEditor.js';

suite('PiChatPromptEditor', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let host: HTMLElement;
	let editor: PiChatPromptEditor;

	setup(() => {
		host = mainWindow.document.createElement('div');
		mainWindow.document.body.append(host);
		editor = store.add(new PiChatPromptEditor(host, false, 'Type here...'));
	});

	teardown(() => host.remove());

	test('shows the placeholder outside the editable content, including after deleting the last character', () => {
		const placeholder = host.querySelector<HTMLElement>('.pi-chat-prompt-placeholder')!;
		editor.value = '';
		assert.deepStrictEqual({ hint: placeholder.textContent, hidden: placeholder.hidden, inside: editor.element.contains(placeholder), value: editor.value }, {
			hint: 'Type here...', hidden: false, inside: false, value: '',
		});
		editor.value = 'draft';
		assert.strictEqual(placeholder.hidden, true);
		editor.element.replaceChildren(mainWindow.document.createElement('br'), mainWindow.document.createTextNode(''));
		editor.element.dispatchEvent(new Event('input', { bubbles: true }));
		assert.deepStrictEqual({ hidden: placeholder.hidden, value: editor.value }, { hidden: false, value: '' });
	});

	test('select-all stays in the prompt and does not reach workbench shortcuts', () => {
		editor.value = 'prompt text';
		editor.focus();
		editor.setSelectionRange(3, 3);
		let bubbled = false;
		host.addEventListener('keydown', () => bubbled = true, { once: true });
		const event = new KeyboardEvent('keydown', { key: 'a', metaKey: isMacintosh, ctrlKey: !isMacintosh, bubbles: true, cancelable: true });
		editor.element.dispatchEvent(event);
		assert.deepStrictEqual({ start: editor.selectionStart, end: editor.selectionEnd, prevented: event.defaultPrevented, bubbled }, { start: 0, end: 11, prevented: true, bubbled: false });
	});

	test('undo and redo shortcuts edit the prompt native undo stack', () => {
		editor.value = 'draft ';
		editor.focus();
		editor.insertFiles([URI.file('/repo/a.ts')]);
		const inserted = editor.value;
		const undo = new KeyboardEvent('keydown', { key: 'z', metaKey: isMacintosh, ctrlKey: !isMacintosh, bubbles: true, cancelable: true });
		editor.element.dispatchEvent(undo);
		assert.deepStrictEqual({ value: editor.value, prevented: undo.defaultPrevented }, { value: 'draft ', prevented: true });
		editor.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', shiftKey: true, metaKey: isMacintosh, ctrlKey: !isMacintosh, bubbles: true, cancelable: true }));
		assert.strictEqual(editor.value, inserted);
	});

	test('inserts a filename chip at the cursor and retains the full reference', () => {
		editor.value = 'before after';
		editor.focus();
		editor.setSelectionRange(7, 7);
		editor.insertFiles([URI.file('/repo/src/example.ts')]);
		assert.deepStrictEqual({ value: editor.value, label: editor.element.querySelector('.pi-chat-file-reference')?.textContent, icon: !!editor.element.querySelector('.codicon-file') }, {
			value: 'before [example.ts](file:///repo/src/example.ts) after', label: 'example.ts', icon: true,
		});
	});

	test('places the caret after the file and its trailing space in an empty prompt', () => {
		editor.value = '';
		editor.focus();
		editor.insertFiles([URI.file('/repo/a.ts')]);
		const cursor = editor.value.length;
		assert.deepStrictEqual({ value: editor.value, start: editor.selectionStart, end: editor.selectionEnd }, {
			value: '[a.ts](file:///repo/a.ts) ', start: cursor, end: cursor,
		});
		editor.element.ownerDocument.execCommand('insertText', false, 'next');
		assert.strictEqual(editor.value, '[a.ts](file:///repo/a.ts) next');
	});

	test('keeps the caret after multiple files inserted in the middle of a draft', () => {
		editor.value = 'before after';
		editor.focus();
		editor.setSelectionRange(7, 7);
		editor.insertFiles([URI.file('/repo/a.ts'), URI.file('/repo/b.ts')]);
		editor.element.ownerDocument.execCommand('insertText', false, 'next ');
		assert.strictEqual(editor.value, 'before [a.ts](file:///repo/a.ts) [b.ts](file:///repo/b.ts) next after');
	});

	test('replaces selected text with multiple file references', () => {
		editor.value = 'replace me';
		editor.focus();
		editor.setSelectionRange(0, 7);
		editor.insertFiles([URI.file('/repo/a.ts'), URI.file('/repo/b.ts')]);
		assert.strictEqual(editor.value, '[a.ts](file:///repo/a.ts) [b.ts](file:///repo/b.ts)  me');
	});

	test('restores chips and multiline text from persisted prompts without interpreting HTML', () => {
		const text = '<script>bad()</script>\n[x].ts](file:///repo/x%5D.ts)\nend';
		editor.value = text;
		assert.deepStrictEqual({ value: editor.value, scripts: editor.element.querySelectorAll('script').length, chips: editor.element.querySelectorAll('.pi-chat-file-reference').length }, { value: text, scripts: 0, chips: 1 });
	});

	test('dictation replaces only its span next to a file chip', () => {
		editor.value = '[a.ts](file:///repo/a.ts) old suffix';
		editor.setRangeText('new words', 26, 29, 'end');
		assert.strictEqual(editor.value, '[a.ts](file:///repo/a.ts) new words suffix');
	});

	test('plain-text paste preserves newlines and does not inject markup', () => {
		editor.value = '';
		editor.focus();
		editor.setSelectionRange(0, 0);
		const data = new DataTransfer();
		data.setData('text/plain', 'one\ntwo\n<img src=x>');
		editor.element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
		assert.deepStrictEqual({ value: editor.value, images: editor.element.querySelectorAll('img').length }, { value: 'one\ntwo\n<img src=x>', images: 0 });
	});

	test('file insertion participates in native undo', () => {
		editor.value = 'draft ';
		editor.focus();
		editor.setSelectionRange(6, 6);
		editor.insertFiles([URI.file('/repo/a.ts')]);
		editor.element.ownerDocument.execCommand('undo');
		assert.strictEqual(editor.value, 'draft ');
	});

	test('remembers the insertion cursor after focus moves to a file tree', () => {
		editor.value = 'before after';
		editor.focus();
		editor.setSelectionRange(7, 7);
		mainWindow.document.dispatchEvent(new Event('selectionchange'));
		const range = mainWindow.document.createRange();
		range.selectNodeContents(host);
		mainWindow.getSelection()!.removeAllRanges();
		mainWindow.getSelection()!.addRange(range);
		editor.insertFiles([URI.file('/repo/a.ts')]);
		assert.strictEqual(editor.value, 'before [a.ts](file:///repo/a.ts) after');
	});

	test('transcript replacement does not emit user input events', () => {
		editor.value = 'old';
		let events = 0;
		editor.element.addEventListener('input', () => events++);
		editor.setRangeText('new', 0, 3, 'end');
		assert.deepStrictEqual({ text: editor.value, events }, { text: 'new', events: 0 });
	});

	test('composer persists and submits full file references, then clears the draft', async () => {
		const storage = store.add(new InMemoryStorageService());
		const cache = new PiChatInputCacheService(storage);
		let sent = '';
		const prompt = store.add(new PiChatPromptInput(host, 'session', cache, async text => { sent = text; }, () => {}));
		prompt.restore('review ');
		prompt.insertFiles([URI.file('/repo/a.ts')]);
		const draft = cache.getDraft('session');
		prompt.submit();
		await new Promise(resolve => mainWindow.setTimeout(resolve, 0));
		assert.deepStrictEqual({ draft, sent, current: prompt.input.value, saved: cache.getDraft('session'), history: cache.getRecent() }, {
			draft: 'review [a.ts](file:///repo/a.ts) ', sent: 'review [a.ts](file:///repo/a.ts)', current: '', saved: '', history: ['review [a.ts](file:///repo/a.ts)'],
		});
	});

	test('disabled composers reject files', () => {
		const disabled = store.add(new PiChatPromptEditor(host, true, 'Select a chat'));
		disabled.insertFiles([URI.file('/repo/a.ts')]);
		assert.strictEqual(disabled.value, '');
	});
});
