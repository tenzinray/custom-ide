/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { PiChatSessionNameDiagnostics } from '../../browser/PiChatSessionNameDiagnostics.js';
import { PiChatSessionSummary } from '../../common/pi-chat-types.js';

suite('PiChatSessionNameDiagnostics', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const session: PiChatSessionSummary = { id: 'chat', repoName: 'custom-ide', repoPath: '/private/repo', sessionFile: URI.file('/private/chat.jsonl'), lastMessageAt: '2026-01-01', sessionName: 'custom-ide - te' };

	test('records suffix loss and restoration per surface, without flooding unchanged renders or leaking paths', () => {
		const messages: string[] = [];
		const log = new class extends NullLogService { override info(...args: Parameters<NullLogService['info']>): void { messages.push(String(args[1])); } }();
		const diagnostics = new PiChatSessionNameDiagnostics(true, log);
		diagnostics.observe('sidebar.render', session, 1);
		diagnostics.observe('sidebar.render', session, 2);
		diagnostics.observe('sidebar.render', { ...session, sessionName: undefined }, 3);
		diagnostics.observe('sidebar.render', session, 4);
		diagnostics.observe('resume.render', session, 1);
		const events = messages.map(message => JSON.parse(message));
		assert.deepStrictEqual({ transitions: events.map(event => [event.source, event.previousName, event.name, event.requestId]), leaksPath: messages.some(message => message.includes('/private/')) }, {
			transitions: [['sidebar.render', null, 'custom-ide - te', 1], ['sidebar.render', 'custom-ide - te', null, 3], ['sidebar.render', null, 'custom-ide - te', 4], ['resume.render', null, 'custom-ide - te', 1]], leaksPath: false,
		});
	});

	test('built-app logging is completely disabled, including explicit metadata events', () => {
		let writes = 0;
		const diagnostics = new PiChatSessionNameDiagnostics(false, new class extends NullLogService { override info(): void { writes++; } }());
		diagnostics.observe('sidebar.render', session);
		diagnostics.record('metadata.probe.publish', session, { size: 100 });
		assert.strictEqual(writes, 0);
	});
});
