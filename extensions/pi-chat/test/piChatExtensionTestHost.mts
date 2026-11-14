/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Module, { createRequire } from 'node:module';
import type * as vscode from 'vscode';

/** Activate the production bootstrap bundle with only its VS Code API boundary substituted. */
export async function activatePiChatTestExtension() {
	const loader = Module as typeof Module & { _load: (id: string, ...args: unknown[]) => unknown };
	const originalLoad = loader._load;
	const commands = new Map<string, Parameters<typeof vscode.commands.registerCommand>[1]>();
	const subscriptions: vscode.Disposable[] = [];
	const errors: string[] = [];
	loader._load = function (id, ...args) {
		if (id === 'vscode') {
			return {
				commands: {
					registerCommand(id: string, callback: Parameters<typeof vscode.commands.registerCommand>[1]) { commands.set(id, callback); return { dispose() {} }; },
					async executeCommand(id: string, ...args: unknown[]) {
						const callback = commands.get(id);
						if (!callback) { throw new Error(`Command not registered: ${id}`); }
						return callback(...args);
					},
				},
				window: { showErrorMessage: (message: string) => { errors.push(message); } },
				l10n: { t: (value: string) => value },
			};
		}
		return originalLoad.call(this, id, ...args);
	};
	try { await createRequire(import.meta.url)('../bootstrap.cjs').activate({ subscriptions }); }
	catch (error) { loader._load = originalLoad; throw error; }
	return { commands, errors, dispose: () => { for (const disposable of subscriptions) { disposable.dispose(); } loader._load = originalLoad; } };
}
