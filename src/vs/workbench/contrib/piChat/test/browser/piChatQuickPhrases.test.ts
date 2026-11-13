/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { renderMarkdown } from '../../../../../base/browser/markdownRenderer.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { PiChatInputCacheService } from '../../browser/PiChatInputCacheService.js';
import { PiChatPromptInput } from '../../browser/footer/PiChatPromptInput.js';
import { decoratePiChatPermissionLinks } from '../../browser/body/PiChatPermissionLinks.js';
import { piChatQuickPhrases, remoteDatabasePermissionPhrase } from '../../common/piChatQuickPhrases.js';

suite('PiChatQuickPhrases', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let host: HTMLElement;
	let cache: PiChatInputCacheService;
	let prompt: PiChatPromptInput;
	let sent: string[];

	setup(() => {
		host = mainWindow.document.createElement('div');
		host.style.cssText = 'position: relative; width: 700px;';
		mainWindow.document.body.append(host);
		cache = new PiChatInputCacheService(store.add(new InMemoryStorageService()));
		sent = [];
		prompt = store.add(new PiChatPromptInput(host, 'chat-a', cache, async text => { sent.push(text); }, () => {}));
	});

	teardown(() => host.remove());

	function type(text: string): void {
		prompt.input.value = text;
		prompt.input.focus();
		prompt.input.setSelectionRange(text.length, text.length);
		prompt.input.element.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function key(key: string, options: KeyboardEventInit = {}): KeyboardEvent {
		const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
		prompt.input.element.dispatchEvent(event);
		return event;
	}

	function hint(): HTMLElement { return host.querySelector<HTMLElement>('.pi-chat-prompt-completion')!; }

	test('Tab expands each trigger, persists it in this chat, and never sends', () => {
		const results = piChatQuickPhrases.map(phrase => {
			type(phrase.trigger);
			const visible = !hint().hidden;
			const prevented = key('Tab').defaultPrevented;
			return { visible, prevented, text: prompt.input.value, cached: cache.getDraft('chat-a') };
		});
		assert.deepStrictEqual({ results, sent, otherDraft: cache.getDraft('chat-b') }, {
			results: piChatQuickPhrases.map(phrase => ({ visible: true, prevented: true, text: phrase.text, cached: phrase.text })),
			sent: [], otherDraft: '',
		});
	});

	test('completes only the current line and preserves earlier draft text', () => {
		type('existing draft\nperm');
		key('Tab');
		assert.deepStrictEqual({ text: prompt.input.value, start: prompt.input.selectionStart, end: prompt.input.selectionEnd, hint: hint().hidden }, {
			text: `existing draft\n${remoteDatabasePermissionPhrase}`, start: prompt.input.value.length, end: prompt.input.value.length, hint: true,
		});
	});

	test('accepted phrases participate in native undo and remain draft-only', () => {
		type('perm');
		key('Tab');
		prompt.input.element.ownerDocument.execCommand('undo');
		assert.deepStrictEqual({ text: prompt.input.value, cached: cache.getDraft('chat-a'), sent }, { text: 'perm', cached: 'perm', sent: [] });
	});

	test('Escape dismisses until text changes and leaves Tab available for normal navigation', () => {
		type('cont');
		const escaped = key('Escape').defaultPrevented;
		const tab = key('Tab').defaultPrevented;
		const dismissed = hint().hidden;
		type('conti');
		assert.deepStrictEqual({ escaped, tab, dismissed, visibleAfterTyping: !hint().hidden, text: prompt.input.value }, {
			escaped: true, tab: false, dismissed: true, visibleAfterTyping: true, text: 'conti',
		});
	});

	test('ignores slash commands, ordinary prose, selections, modified Tab and composition', () => {
		const ignored = ['/cont', '/perm', 'please cont', 'continue', ''].map(text => {
			type(text);
			return { hidden: hint().hidden, prevented: key('Tab').defaultPrevented };
		});
		type('cont');
		const shiftTab = key('Tab', { shiftKey: true }).defaultPrevented;
		prompt.input.setSelectionRange(0, 4);
		const selectedTab = key('Tab').defaultPrevented;
		type('cont');
		prompt.input.element.dispatchEvent(new CompositionEvent('compositionstart'));
		const composingTab = key('Tab', { isComposing: true }).defaultPrevented;
		assert.deepStrictEqual({ ignored, shiftTab, selectedTab, composingTab, composingHidden: hint().hidden }, {
			ignored: Array(5).fill({ hidden: true, prevented: false }), shiftTab: false, selectedTab: false, composingTab: false, composingHidden: true,
		});
	});

	test('dictation hides completions and blur does not leave ghost text visible', () => {
		type('cont');
		prompt.setDictating(true);
		const dictatingHidden = hint().hidden;
		prompt.setDictating(false);
		prompt.input.element.blur();
		assert.deepStrictEqual({ dictatingHidden, blurredHidden: hint().hidden }, { dictatingHidden: true, blurredHidden: true });
	});

	test('permission links handle inline formatting and append only to the owning chat draft', () => {
		const otherHost = mainWindow.document.createElement('div');
		host.append(otherHost);
		const other = store.add(new PiChatPromptInput(otherHost, 'chat-b', cache, async text => { sent.push(text); }, () => {}));
		other.restore('other chat');
		prompt.restore('existing draft');
		const content = store.add(renderMarkdown(new MarkdownString(`Before **${remoteDatabasePermissionPhrase}** After\n\nI give you **permission** to apply this change to the remote database.`)));
		content.element.classList.add('pi-chat-assistant-text');
		host.append(content.element);
		decoratePiChatPermissionLinks(host, text => prompt.restore(text), store);
		const buttons = Array.from(content.element.querySelectorAll<HTMLButtonElement>('.pi-chat-permission-link'));
		buttons[1].click();
		assert.deepStrictEqual({ labels: buttons.map(button => button.textContent), text: prompt.input.value, cached: cache.getDraft('chat-a'), other: other.input.value, sent, focused: mainWindow.document.activeElement === prompt.input.element }, {
			labels: Array(2).fill(remoteDatabasePermissionPhrase), text: `existing draft\n${remoteDatabasePermissionPhrase}`, cached: `existing draft\n${remoteDatabasePermissionPhrase}`, other: 'other chat', sent: [], focused: true,
		});
	});

	test('permission clicks work in empty drafts and do not duplicate an existing trailing newline', () => {
		const content = store.add(renderMarkdown(new MarkdownString(`\`${remoteDatabasePermissionPhrase}\``)));
		content.element.classList.add('pi-chat-assistant-text');
		host.append(content.element);
		decoratePiChatPermissionLinks(host, text => prompt.restore(text), store);
		const button = content.element.querySelector<HTMLButtonElement>('.pi-chat-permission-link')!;
		button.click();
		const emptyDraft = prompt.input.value;
		prompt.input.value = 'draft\n';
		button.click();
		assert.deepStrictEqual({ emptyDraft, trailingNewline: prompt.input.value, sent }, {
			emptyDraft: remoteDatabasePermissionPhrase, trailingNewline: `draft\n${remoteDatabasePermissionPhrase}`, sent: [],
		});
	});

	test('handles repeated sentences but leaves fenced code, existing links, and user messages alone', () => {
		const content = store.add(renderMarkdown(new MarkdownString(`${remoteDatabasePermissionPhrase} ${remoteDatabasePermissionPhrase}\n\n\`\`\`text\n${remoteDatabasePermissionPhrase}\n\`\`\`\n\n[${remoteDatabasePermissionPhrase}](https://example.test)`)));
		content.element.classList.add('pi-chat-assistant-text');
		host.append(content.element);
		const user = mainWindow.document.createElement('div');
		user.className = 'pi-chat-user';
		user.textContent = remoteDatabasePermissionPhrase;
		host.append(user);
		decoratePiChatPermissionLinks(host, text => prompt.restore(text), store);
		assert.deepStrictEqual({ buttons: content.element.querySelectorAll('.pi-chat-permission-link').length, codeButtons: content.element.querySelectorAll('pre button').length, linkButtons: content.element.querySelectorAll('a button').length, userButtons: user.querySelectorAll('button').length }, {
			buttons: 2, codeButtons: 0, linkButtons: 0, userButtons: 0,
		});
	});
});
