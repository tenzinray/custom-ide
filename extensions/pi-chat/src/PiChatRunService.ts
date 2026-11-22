/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { open, realpath, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { createAgentSession, getAgentDir, hasTrustRequiringProjectResources, ModelRuntime, ProjectTrustStore, SessionManager, SettingsManager, type AgentSession, type AgentSessionEvent, type ContextUsage } from '@earendil-works/pi-coding-agent';
import type { PiChatCreatedSession, PiChatQueuedPrompt, PiChatRunEvent, PiChatRunSnapshot } from '../../../src/vs/workbench/contrib/piChat/common/pi-chat-run-types.js';
import { PiChatSteeringQueue } from './PiChatSteeringQueue.js';

interface Run {
	readonly session: AgentSession;
	readonly modelRuntime: ModelRuntime;
	readonly queue: PiChatSteeringQueue;
	readonly events: PiChatRunEvent[];
	immediate: PiChatQueuedPrompt | undefined;
	resumeQueued: boolean;
	baseIndex: number;
	running: boolean;
	stopRequested: boolean;
}

const runs = new Map<string, Run>();
const opening = new Map<string, Promise<Run>>();
let accountChanging = false;

/** Account selection cannot interrupt an active response or a session opening for a turn. */
export function isPiChatRunning(): boolean {
	return opening.size > 0 || [...runs.values()].some(run => run.running);
}

export async function withPiChatAccountChange(change: () => Promise<void>): Promise<void> {
	if (accountChanging || isPiChatRunning()) { throw new Error(vscode.l10n.t('Wait for all Pi responses to finish before changing accounts.')); }
	accountChanging = true;
	try { await change(); } finally { accountChanging = false; }
}

/** Reuse Pi's exact estimate while this session is already open for a turn. */
export function getPiChatActiveContextUsage(id: string): ContextUsage | undefined {
	return runs.get(id)?.session.getContextUsage();
}

function checkWorkspaceTrust(): void {
	if (!vscode.workspace.isTrusted) { throw new Error('Trust this workspace before running Pi tools.'); }
}

export async function checkSessionFile(id: string, file: string, cwd: string): Promise<string> {
	const root = await realpath(resolve(getAgentDir(), 'sessions'));
	const path = await realpath(file);
	const child = relative(root, path);
	if (!child || child.startsWith('..') || resolve(root, child) !== path || !path.endsWith('.jsonl')) {
		throw new Error('This is not a Pi session file.');
	}
	const handle = await open(path, 'r');
	let firstLine: string;
	try {
		const buffer = Buffer.alloc(16_384);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		firstLine = buffer.toString('utf8', 0, bytesRead).split('\n')[0];
	} finally { await handle.close(); }
	const header = JSON.parse(firstLine) as { id?: string; cwd?: string };
	if (header.id !== id || header.cwd !== cwd) { throw new Error('Pi session does not match its repository.'); }
	return path;
}

async function openSession(id: string | undefined, file: string | undefined, cwd: string): Promise<Run> {
	checkWorkspaceTrust();
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	const savedTrust = new ProjectTrustStore(agentDir).get(cwd);
	settingsManager.setProjectTrusted(!hasTrustRequiringProjectResources(cwd) || (savedTrust ?? settingsManager.getDefaultProjectTrust() === 'always'));
	const manager = file ? SessionManager.open(await checkSessionFile(id!, file, cwd)) : SessionManager.create(cwd, undefined, id ? { id } : undefined);
	const modelRuntime = await ModelRuntime.create();
	const { session } = await createAgentSession({ cwd, agentDir, sessionManager: manager, settingsManager, modelRuntime });
	try {
		await session.bindExtensions({ mode: 'rpc' });
		if (!session.sessionFile) { throw new Error('Pi did not create a session.'); }
		const run: Run = { session, modelRuntime, queue: new PiChatSteeringQueue(session), events: [], baseIndex: 0, running: false, stopRequested: false, immediate: undefined, resumeQueued: false };
		runs.set(session.sessionId, run);
		return run;
	} catch (error) {
		session.dispose();
		throw error;
	}
}

/** Workspace project folders do not need Git metadata to be valid Pi working directories. */
async function checkProjectDirectory(cwd: string): Promise<void> {
	if (typeof cwd !== 'string' || !cwd) { throw new Error('Select a local project folder.'); }
	const directory = await stat(cwd).catch(() => undefined);
	if (!directory?.isDirectory()) { throw new Error('Select a local project folder.'); }
}

/** Create a persistent Pi session for a selected local project. */
export async function createPiChatSession(cwd: string): Promise<PiChatCreatedSession> {
	await checkProjectDirectory(cwd);
	const run = await openSession(undefined, undefined, cwd);
	return { id: run.session.sessionId, sessionFile: run.session.sessionFile! };
}

/** Recreate an unsaved Pi draft using its original session ID after a reload. */
export async function restorePiChatDraft(id: string, cwd: string, sessionName?: string): Promise<PiChatCreatedSession> {
	if (!/^[a-f0-9-]{36}$/.test(id) || typeof cwd !== 'string' || !cwd) { throw new Error('Invalid Pi draft.'); }
	await checkProjectDirectory(cwd);
	const run = runs.get(id) ?? await openSession(id, undefined, cwd);
	if (typeof sessionName === 'string' && sessionName.trim()) { run.session.setSessionName(sessionName); }
	return { id: run.session.sessionId, sessionFile: run.session.sessionFile! };
}

async function getRun(id: string, file: string, cwd: string): Promise<Run> {
	const existing = runs.get(id);
	if (existing) { return existing; }
	let pending = opening.get(id);
	if (!pending) {
		pending = openSession(id, file, cwd);
		opening.set(id, pending);
		void pending.finally(() => opening.delete(id)).catch(() => {});
	}
	return pending;
}

/** Use Pi's native name entry, reusing a live manager so streaming cannot overwrite it. */
export async function renamePiChatSession(id: string, file: string, cwd: string, name: string): Promise<void> {
	if (typeof name !== 'string' || !name.trim()) { throw new Error(vscode.l10n.t('Enter a chat name.')); }
	await opening.get(id);
	let run = runs.get(id);
	let path: string | undefined;
	if (!run) {
		path = await checkSessionFile(id, file, cwd);
		// A send can begin while filesystem validation is awaiting I/O.
		await opening.get(id);
		run = runs.get(id);
	}
	if (run) {
		if (run.session.sessionFile !== file || run.session.sessionManager.getCwd() !== cwd) { throw new Error('Pi session does not match its repository.'); }
		run.session.setSessionName(name.trim());
	} else {
		SessionManager.open(path!).appendSessionInfo(name.trim());
	}
}

function emit(run: Run, event: PiChatRunEvent): void {
	run.events.push(event);
	if (run.events.length > 1000) { run.events.shift(); run.baseIndex++; }
}

function toolInput(name: string, args: Record<string, unknown>): string {
	const value = name === 'bash' ? args.command : args.path ?? args.pattern ?? args.query ?? args.url;
	return (typeof value === 'string' ? value : JSON.stringify(args)).slice(0, 1000);
}

function toolOutput(content: readonly { type: string; text?: string }[]): string {
	return content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n').slice(0, 4000);
}

function forward(event: AgentSessionEvent, run: Run, turn: { index: number; inputs: Map<string, string> }): void {
	let forwarded = false;
	if (event.type === 'message_start' && event.message.role === 'assistant') { turn.index++; }
	if (event.type === 'message_start' && event.message.role === 'user') {
		const content = event.message.content;
		const text = typeof content === 'string' ? content : content.filter(block => block.type === 'text').map(block => block.text).join('\n');
		const prompt = run.queue.consume(text);
		if (prompt) { emit(run, { type: 'queuedSent', prompt }); forwarded = true; }
	}
	if (event.type === 'message_update') {
		const update = event.assistantMessageEvent;
		if (update.type === 'text_delta' || update.type === 'thinking_delta') {
			emit(run, { type: 'delta', id: `live-${turn.index}-${update.contentIndex}`, kind: update.type === 'text_delta' ? 'text' : 'thinking', delta: update.delta });
			forwarded = true;
		}
	} else if (event.type === 'tool_execution_start') {
		const input = toolInput(event.toolName, event.args);
		turn.inputs.set(event.toolCallId, input);
		forwarded = true;
		emit(run, { type: 'tool', message: { id: `live-tool-${event.toolCallId}`, role: 'assistant', kind: 'tool', toolName: event.toolName, input, state: 'running' } });
	} else if (event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
		forwarded = true;
		const input = turn.inputs.get(event.toolCallId) ?? event.toolName;
		const content = event.type === 'tool_execution_end' ? event.result.content : event.partialResult.content;
		emit(run, { type: 'tool', message: { id: `live-tool-${event.toolCallId}`, role: 'assistant', kind: 'tool', toolName: event.toolName, input, output: toolOutput(content), state: event.type === 'tool_execution_end' ? event.isError ? 'failed' : 'completed' : 'running' } });
		if (event.type === 'tool_execution_end') { turn.inputs.delete(event.toolCallId); }
	}
	if (!forwarded) { emit(run, { type: 'activity' }); }
}

/** Start a turn without blocking the command channel; pollTurn reads the event stream. */
export async function startPiChatTurn(id: string, file: string, cwd: string, text: string, modelName?: string): Promise<void> {
	checkWorkspaceTrust();
	if (typeof text !== 'string' || !text.trim() || text.length > 20_000) { throw new Error('Enter a message under 20,000 characters.'); }
	if (accountChanging) { throw new Error(vscode.l10n.t('Wait for the account change to finish before sending a message.')); }
	const run = await getRun(id, file, cwd);
	if (accountChanging) { throw new Error(vscode.l10n.t('Wait for the account change to finish before sending a message.')); }
	if (run.running) { throw new Error('This Pi session already has a running turn.'); }
	run.events.length = 0;
	run.baseIndex = 0;
	run.running = true;
	run.stopRequested = false;
	void (async () => {
		const turn = { index: 0, inputs: new Map<string, string>() };
		const unsubscribe = run.session.subscribe(event => {
			forward(event, run, turn);
			if (event.type === 'agent_start' && run.stopRequested) { void run.session.abort(); }
			if (event.type === 'agent_start' && run.resumeQueued) {
				run.resumeQueued = false;
				void run.queue.restore().catch(error => emit(run, { type: 'error', message: error instanceof Error ? error.message : 'Could not restore queued prompts.' }));
			}
		});
		try {
			if (modelName) {
				const slash = modelName.indexOf('/');
				const model = run.modelRuntime.getModel(modelName.slice(0, slash), modelName.slice(slash + 1));
				if (!model || slash < 1) { throw new Error('Selected Pi model is not available.'); }
				if (run.session.model?.provider !== model.provider || run.session.model.id !== model.id) { await run.session.setModel(model); }
			}
			let nextPrompt: string | undefined = text;
			while (nextPrompt) {
				try { if (!run.stopRequested) { await run.session.prompt(nextPrompt); } }
				catch (error) { if (!run.stopRequested) { throw error; } }
				const immediate = run.immediate;
				const next = immediate ?? (!run.stopRequested ? run.queue.takeFirst() : undefined);
				if (!next) { break; }
			run.immediate = undefined;
				run.stopRequested = false;
				run.resumeQueued = run.queue.needsRestore;
				emit(run, { type: 'queuedSent', prompt: next });
				nextPrompt = next.text;
			}
			emit(run, { type: 'complete' });
		} catch (error) {
			emit(run, { type: 'error', message: error instanceof Error ? error.message : 'Pi could not send this message.' });
		} finally {
			unsubscribe();
			run.running = false;
		}
	})();
}

/** Steer at Pi's next safe point (after current tool calls). */
export async function queuePiChatPrompt(id: string, promptId: string, text: string): Promise<PiChatQueuedPrompt[]> {
	checkWorkspaceTrust();
	if (typeof text !== 'string' || !text.trim() || text.length > 20_000) { throw new Error('Enter a message under 20,000 characters.'); }
	const run = runs.get(id);
	if (!run?.running || run.stopRequested || run.immediate) { throw new Error('This turn has finished. Send the message again.'); }
	await run.queue.add(promptId, text);
	return run.queue.items;
}

export async function cancelPiChatPrompt(id: string, promptId: string): Promise<PiChatQueuedPrompt | undefined> {
	const run = runs.get(id);
	return run?.queue.remove(promptId);
}

/** Abort the current response, then send this queued prompt as the next turn. */
export async function sendPiChatPromptNow(id: string, promptId: string): Promise<void> {
	const run = runs.get(id);
	if (!run?.running || run.immediate) { throw new Error('The turn is no longer running.'); }
	const prompt = await run.queue.remove(promptId, false);
	if (!prompt) { throw new Error('This prompt has already been sent.'); }
	run.immediate = prompt;
	run.stopRequested = true;
	run.session.abortCompaction();
	await run.session.abort();
}

export function pollPiChatTurn(id: string, index: number): PiChatRunSnapshot {
	const run = runs.get(id);
	if (!run) { return { events: [], nextIndex: 0, running: false, compacting: false, queued: [] }; }
	const start = Math.max(0, index - run.baseIndex);
	return { events: run.events.slice(start), nextIndex: run.baseIndex + run.events.length, running: run.running, compacting: run.session.isCompacting, queued: run.queue.items };
}

export async function stopPiChatTurn(id: string): Promise<PiChatQueuedPrompt[]> {
	const run = runs.get(id);
	if (!run?.running) { return []; }
	run.stopRequested = true;
	const unsent = run.queue.clear();
	run.session.abortCompaction();
	await run.session.abort();
	return unsent;
}

export function disposePiChatRuns(): void {
	for (const run of runs.values()) { void run.session.abort(); run.session.dispose(); }
	runs.clear();
}
