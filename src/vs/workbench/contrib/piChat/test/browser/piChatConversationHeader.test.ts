/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
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

	test('moving global ownership removes old limits, and editor headers still show them by default', () => {
		const header = document.createElement('header');
		renderPiChatHeader(header, summary, history, limits);
		const before = header.querySelectorAll('.pi-chat-openai-limits').length;
		renderPiChatHeader(header, summary, history, limits, false);
		assert.deepStrictEqual([before, header.querySelectorAll('.pi-chat-openai-limits').length], [1, 0]);
	});
});
