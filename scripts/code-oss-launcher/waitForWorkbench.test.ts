/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { suite, test } from 'node:test';
import { WebSocketServer } from 'ws';
import { waitForWorkbench } from './waitForWorkbench.ts';

suite('rendered workbench readiness', () => {
	for (const scenario of ['ready', 'blank renderer', 'unresponsive renderer', 'only an existing window', 'unrelated page']) {
		test(scenario, async () => {
			let port = 0;
			const server = http.createServer((_request, response) => {
				response.setHeader('Content-Type', 'application/json');
				response.end(JSON.stringify([{ id: 'window-1', type: 'page', url: scenario === 'unrelated page' ? 'about:blank' : 'vscode-file://vscode-app/out/vs/code/electron-browser/workbench/workbench-dev.html', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/window-1` }]));
			});
			const sockets = new WebSocketServer({ server });
			sockets.on('connection', socket => socket.on('message', data => {
				if (scenario === 'unresponsive renderer') { return; }
				const request = JSON.parse(data.toString()) as { id: number; method: string };
				assert.strictEqual(request.method, 'Runtime.evaluate');
				socket.send(JSON.stringify({ id: request.id, result: { result: { value: { documentState: 'complete', workbench: scenario !== 'blank renderer', editor: scenario !== 'blank renderer', visible: true } } } }));
			}));
			server.listen(0, '127.0.0.1');
			await once(server, 'listening');
			port = (server.address() as AddressInfo).port;
			const messages: string[] = [];
			try {
				const result = await waitForWorkbench(process.pid, port, scenario === 'ready' ? 2000 : 150, message => messages.push(message), scenario === 'only an existing window' ? ['window-1'] : []);
				assert.strictEqual(result.status, scenario === 'ready' ? 'ready' : 'timeout', JSON.stringify({ result, messages }));
				if (result.status === 'ready') { assert.strictEqual(result.windowId, 'window-1'); }
				else { assert.ok(result.detail.length > 0); }
			} finally {
				for (const socket of sockets.clients) { socket.terminate(); }
				await new Promise<void>(resolve => sockets.close(() => resolve()));
				server.closeAllConnections();
				await new Promise<void>(resolve => server.close(() => resolve()));
			}
		});
	}

	test('reports an exited app rather than treating some other process as success', async () => {
		assert.strictEqual((await waitForWorkbench(1_000_000_000, 1, 1000, () => {})).status, 'exited');
	});
});
