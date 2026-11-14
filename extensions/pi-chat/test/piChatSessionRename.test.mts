/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { activatePiChatTestExtension } from './piChatExtensionTestHost.mts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Exercise the same bootstrap/dist bundle loaded by VS Code, not a mock rename implementation.
// Run after `node extensions/pi-chat/esbuild.mts` with `node --test extensions/pi-chat/test/*.test.mts`.
test('runtime bundle registers rename and persists a native session name', async () => {
	const root = await mkdtemp(join(tmpdir(), 'pi-chat-rename-'));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	const host = await activatePiChatTestExtension();
	try {
		const rename = host.commands.get('piChat.renameSession');
		assert.equal(typeof rename, 'function', 'Rebuild the runtime bundle: bootstrap.cjs must register piChat.renameSession.');
		const directory = join(root, 'sessions', 'project');
		await mkdir(directory, { recursive: true });
		const file = join(directory, 'session.jsonl');
		const id = randomUUID();
		const header = { type: 'session', version: 3, id, cwd: directory, timestamp: new Date().toISOString() };
		await writeFile(file, `${JSON.stringify(header)}\n`);
		await rename!(id, file, directory, 'Renamed chat');
		const entries = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
		assert.deepStrictEqual({ header: entries[0], type: entries.at(-1).type, name: entries.at(-1).name }, {
			header, type: 'session_info', name: 'Renamed chat',
		});
	} finally {
		host.dispose();
		if (previousAgentDir === undefined) { delete process.env.PI_CODING_AGENT_DIR; }
		else { process.env.PI_CODING_AGENT_DIR = previousAgentDir; }
		await rm(root, { recursive: true, force: true });
	}
});
