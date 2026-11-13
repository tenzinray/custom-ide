/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import Module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type * as vscode from 'vscode';

// Exercise the same bootstrap/dist bundle loaded by VS Code, not a mock rename implementation.
// Run after `node extensions/pi-chat/esbuild.mts` with `node --test extensions/pi-chat/test/*.test.mts`.
test('runtime bundle registers rename and persists a native session name', async () => {
	const root = await mkdtemp(join(tmpdir(), 'pi-chat-rename-'));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	// Node exposes this CommonJS loader hook at runtime but not in its public type definitions.
	const loader = Module as typeof Module & { _load: (id: string, ...args: unknown[]) => unknown };
	const originalLoad = loader._load;
	const commands = new Map<string, Parameters<typeof vscode.commands.registerCommand>[1]>();
	const subscriptions: vscode.Disposable[] = [];
	process.env.PI_CODING_AGENT_DIR = root;
	loader._load = function (id, ...args) {
		if (id === 'vscode') {
			return {
				commands: { registerCommand(id: string, callback: Parameters<typeof vscode.commands.registerCommand>[1]) { commands.set(id, callback); return { dispose() {} }; } },
				l10n: { t: (value: string) => value },
			};
		}
		return originalLoad.call(this, id, ...args);
	};
	try {
		await createRequire(import.meta.url)('../bootstrap.cjs').activate({ subscriptions });
		const rename = commands.get('piChat.renameSession');
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
		for (const disposable of subscriptions) { disposable.dispose(); }
		loader._load = originalLoad;
		if (previousAgentDir === undefined) { delete process.env.PI_CODING_AGENT_DIR; }
		else { process.env.PI_CODING_AGENT_DIR = previousAgentDir; }
		await rm(root, { recursive: true, force: true });
	}
});
