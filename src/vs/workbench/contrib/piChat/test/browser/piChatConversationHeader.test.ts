/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import '../../browser/media/piChat.css';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { IPiChatOpenAILimitsService } from '../../browser/PiChatOpenAILimitsService.js';
import { renderPiChatHeader } from '../../browser/header/PiChatConversationHeader.js';
import { PiChatSessionHistory, PiChatSessionSummary } from '../../common/pi-chat-types.js';

suite('Pi chat global usage header', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const summary: PiChatSessionSummary = { id: 'chat', repoName: 'project', repoPath: '/project', sessionFile: URI.file('/chat.jsonl'), lastMessageAt: '2026-01-01' };
	const history: PiChatSessionHistory = { modelName: 'model', messages: [], usage: { input: 100, output: 20, cacheRead: 5 } };
	const limits = upcastPartial<IPiChatOpenAILimitsService>({ refreshing: true });

	test('only the designated rightmost pane shows account limits while each chat keeps session stats', () => {
		const left = document.createElement('header');
		const right = document.createElement('header');
		renderPiChatHeader(left, summary, history, limits, false);
		renderPiChatHeader(right, summary, history, limits, true);
		assert.deepStrictEqual({ leftLimits: left.querySelectorAll('.pi-chat-openai-limits').length, rightLimits: right.querySelectorAll('.pi-chat-openai-limits').length, stats: [left, right].map(header => header.querySelectorAll('.pi-chat-usage-stats').length) }, { leftLimits: 0, rightLimits: 1, stats: [1, 1] });
	});

	test('usage values match percentage text and both rows tighten toward their shared center; messages stay one tier above tools', () => {
		const host = document.createElement('div');
		host.style.cssText = '--vscode-fontSize-label3: 10px; --vscode-fontSize-label1: 12px; --vscode-spacing-sizeNone: 0px;';
		mainWindow.document.body.append(host);
		try {
			const header = document.createElement('header');
			host.append(header);
			renderPiChatHeader(header, summary, history, limits, false);
			for (const className of ['pi-chat-limit-row', 'pi-chat-message-text', 'pi-chat-assistant-text', 'pi-chat-activity-target']) {
				const sample = document.createElement('div'); sample.className = className; sample.textContent = 'Sample'; host.append(sample);
			}
			const size = (selector: string) => mainWindow.getComputedStyle(host.querySelector(selector)!).fontSize;
			const value = host.querySelector('strong')!.getBoundingClientRect();
			const label = host.querySelector('.pi-chat-usage-stat span')!.getBoundingClientRect();
			const stat = host.querySelector('.pi-chat-usage-stat')!.getBoundingClientRect();
			assert.deepStrictEqual({ values: [...host.querySelectorAll('strong')].map(value => mainWindow.getComputedStyle(value).fontSize), percentage: size('.pi-chat-limit-row'), gap: mainWindow.getComputedStyle(host.querySelector('.pi-chat-usage-stat')!).gap, centered: Math.abs((label.top + value.bottom) / 2 - (stat.top + stat.bottom) / 2) < 1, sent: size('.pi-chat-message-text'), response: size('.pi-chat-assistant-text'), tools: size('.pi-chat-activity-target') }, {
				values: Array(4).fill('10px'), percentage: '10px', gap: '0px', centered: true, sent: '12px', response: '12px', tools: '11px',
			});
		} finally { host.remove(); }
	});

	test('moving global ownership removes old limits, and editor headers still show them by default', () => {
		const header = document.createElement('header');
		renderPiChatHeader(header, summary, history, limits);
		const before = header.querySelectorAll('.pi-chat-openai-limits').length;
		renderPiChatHeader(header, summary, history, limits, false);
		assert.deepStrictEqual([before, header.querySelectorAll('.pi-chat-openai-limits').length], [1, 0]);
	});
});
