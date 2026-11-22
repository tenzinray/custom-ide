/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Target } from '../../src/vs/base/node/profiling.ts';
import { isProcessRunning, readCdpJson } from './waitForCdp.ts';

interface WorkbenchState {
	readonly documentState: string;
	readonly workbench: boolean;
	readonly editor: boolean;
	readonly visible: boolean;
}

export type WorkbenchWaitResult =
	| { readonly status: 'ready'; readonly windowId: string; readonly elapsedMs: number }
	| { readonly status: 'timeout' | 'exited'; readonly detail: string };

/** Confirm a rendered workbench in this launch's CDP endpoint, not a globally discovered dev PID. */
export async function waitForWorkbench(pid: number, port: number, timeoutMs: number, report: (message: string) => void, previousWindowIds: readonly string[] = []): Promise<WorkbenchWaitResult> {
	const started = performance.now();
	let detail = 'No workbench page target has appeared';
	let lastReport = '';
	while (performance.now() - started < timeoutMs) {
		if (!isProcessRunning(pid)) { return { status: 'exited', detail }; }
		const remaining = () => Math.max(1, timeoutMs - (performance.now() - started));
		const pages = await readWorkbenchTargets(port, Math.min(1000, remaining()));
		if (pages) {
			detail = `Workbench targets: ${pages.length}; waiting for a ${previousWindowIds.length ? 'new ' : ''}rendered window`;
			for (const target of pages) {
				if (previousWindowIds.includes(target.id) || typeof target.webSocketDebuggerUrl !== 'string') { continue; }
				const state = await inspectWorkbench(target.webSocketDebuggerUrl, Math.min(1500, remaining()));
				detail = `Window ${target.id}: ${state ? JSON.stringify(state) : 'CDP renderer evaluation did not respond'}`;
				if (state?.documentState === 'complete' && state.workbench && state.editor && state.visible && performance.now() - started < timeoutMs && isProcessRunning(pid)) {
					report(detail);
					return { status: 'ready', windowId: target.id, elapsedMs: Math.round(performance.now() - started) };
				}
			}
		} else { detail = 'CDP target enumeration did not respond'; }
		if (detail !== lastReport) { report(detail); lastReport = detail; }
		await new Promise(resolve => setTimeout(resolve, Math.min(250, remaining())));
	}
	return { status: 'timeout', detail };
}

async function readWorkbenchTargets(port: number, timeoutMs: number): Promise<Target[] | undefined> {
	const targets = await readCdpJson<Target[]>(port, '/json/list', timeoutMs);
	return Array.isArray(targets) ? targets.filter(target => target?.type === 'page' && typeof target.url === 'string' && /\/workbench\/workbench(?:-dev)?\.html(?:$|[?#])/.test(target.url)) : undefined;
}

function inspectWorkbench(url: string, timeoutMs: number): Promise<WorkbenchState | undefined> {
	return new Promise(resolve => {
		const socket = new WebSocket(url);
		let finished = false;
		const finish = (state?: WorkbenchState) => {
			if (finished) { return; }
			finished = true;
			clearTimeout(timer);
			socket.close();
			resolve(state);
		};
		const timer = setTimeout(() => finish(), timeoutMs);
		socket.addEventListener('open', () => { if (!finished) { socket.send(JSON.stringify({
			id: 1, method: 'Runtime.evaluate', params: {
				expression: `(() => { const workbench = document.querySelector('.monaco-workbench'); const editor = document.querySelector('.monaco-workbench .part.editor'); return { documentState: document.readyState, workbench: !!workbench, editor: !!editor && editor.getBoundingClientRect().width > 0 && editor.getBoundingClientRect().height > 0, visible: document.visibilityState === 'visible' }; })()`,
				returnByValue: true,
			},
		})); } }, { once: true });
		socket.addEventListener('message', event => {
			if (typeof event.data !== 'string') { return; }
			try {
				const reply = JSON.parse(event.data) as { id?: number; result?: { result?: { value?: WorkbenchState } } };
				if (reply.id === 1) { finish(reply.result?.result?.value); }
			} catch { finish(); }
		});
		socket.addEventListener('error', () => finish(), { once: true });
		socket.addEventListener('close', () => finish(), { once: true });
	});
}

if (import.meta.main) {
	const [pidArg, portArg, timeoutArg = '30000', previousArg = '[]'] = process.argv.slice(2);
	const pid = Number(pidArg);
	const port = Number(portArg);
	if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port) || port <= 0 || port > 65535) {
		console.error('Usage: waitForWorkbench.ts <pid> <port> <timeout-ms|--list> [previous-window-ids-json]');
		process.exitCode = 2;
	} else if (timeoutArg === '--list') {
		const targets = await readWorkbenchTargets(port, 2000);
		if (!targets || !isProcessRunning(pid)) { console.error('Could not enumerate this dev app’s windows'); process.exitCode = 1; }
		else { console.log(JSON.stringify(targets.map(target => target.id))); }
	} else {
		const timeoutMs = Number(timeoutArg);
		const previous: string[] = JSON.parse(previousArg);
		if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Array.isArray(previous) || !previous.every(id => typeof id === 'string')) {
			throw new Error('Invalid workbench verification arguments');
		}
		const result = await waitForWorkbench(pid, port, timeoutMs, message => console.error(`[workbench] ${new Date().toISOString()} ${message}`), previous);
		console.log(JSON.stringify(result));
		if (result.status !== 'ready') { process.exitCode = 1; }
	}
}
