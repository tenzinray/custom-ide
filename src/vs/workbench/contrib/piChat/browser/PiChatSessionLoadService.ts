/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileService } from '../../../../platform/files/common/files.js';
import { PiChatMessage, PiChatSessionHistory, PiChatSessionSummary } from '../common/pi-chat-types.js';

type ContentBlock = { type: string; text?: string; thinking?: string; name?: string; id?: string; arguments?: Record<string, unknown> };
type Content = string | ContentBlock[];
type Entry = { id: string; parentId?: string | null; type: string; summary?: string; display?: boolean; content?: Content; message?: {
	role?: string; content?: Content;
	provider?: string; model?: string; stopReason?: string; errorMessage?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number };
	command?: string; output?: string; exitCode?: number; toolCallId?: string; toolName?: string; isError?: boolean; display?: boolean;
}; provider?: string; modelId?: string; };

function textContent(content: Content | undefined): string {
	return typeof content === 'string' ? content : Array.isArray(content) ? content.map(block => block.type === 'text' ? block.text ?? '' : block.type === 'image' ? '[Image]' : '').filter(Boolean).join('\n') : '';
}

function toolInput(name: string, args: Record<string, unknown>): string {
	const value = name === 'bash' ? args.command : name === 'grep' || name === 'find' ? args.pattern : name === 'web_search' ? args.query ?? args.queries : args.path ?? args.filePath ?? args.url ?? args.query;
	return (typeof value === 'string' ? value : JSON.stringify(value ?? args)).slice(0, 1000);
}

/** Maps Pi JSONL's active parent chain into the same saved-message display kinds as Pi UI. */
export class PiChatSessionLoadService {
	constructor(@IFileService private readonly fileService: IFileService) { }

	async loadSession(summary: PiChatSessionSummary): Promise<PiChatSessionHistory> {
		if (summary.isDraft) {
			return { modelName: '', messages: [], usage: { input: 0, output: 0, cacheRead: 0, contextTokens: 0, contextWindow: 0 } };
		}
		const file = (await this.fileService.readFile(summary.sessionFile)).value.toString();
		const entries: Entry[] = [];
		for (const line of file.split('\n')) {
			if (!line.trim()) { continue; }
			try {
				const entry = JSON.parse(line) as Entry;
				if (entry.id && entry.type !== 'session') { entries.push(entry); }
			} catch { /* Ignore a partially written final line. */ }
		}
		// SessionManager.getBranch() follows the last entry's parentId through the active branch.
		const byId = new Map(entries.map(entry => [entry.id, entry]));
		const branch: Entry[] = [];
		let current = entries.at(-1);
		while (current) {
			branch.push(current);
			current = current.parentId ? byId.get(current.parentId) : undefined;
		}
		branch.reverse();
		const messages: PiChatMessage[] = [];
		const toolCalls = new Map<string, Extract<PiChatMessage, { kind: 'tool' }>>();
		const usage = { input: 0, output: 0, cacheRead: 0, contextTokens: 0, contextWindow: 0 };
		let modelName = 'Unknown model';
		for (const entry of branch) {
			if (entry.type === 'model_change') { modelName = `${entry.provider}/${entry.modelId}`; }
			if (entry.type === 'compaction') { messages.push({ id: entry.id, role: 'assistant', kind: 'notice', noticeType: 'compaction', content: 'Context compacted.' }); }
			if (entry.type === 'branch_summary') { messages.push({ id: entry.id, role: 'assistant', kind: 'notice', noticeType: 'branchSummary', content: `Branch summary: ${entry.summary?.slice(0, 500) ?? ''}` }); }
			if (entry.type === 'custom_message' && entry.display) { messages.push({ id: entry.id, role: 'assistant', kind: 'text', content: textContent(entry.content) }); }
			if (entry.type !== 'message' || !entry.message) { continue; }
			const message = entry.message;
			if (message.role === 'user') {
				messages.push({ id: entry.id, role: 'user', content: textContent(message.content as Content) });
			} else if (message.role === 'assistant') {
				modelName = `${message.provider}/${message.model}`;
				usage.input += message.usage?.input ?? 0;
				usage.output += message.usage?.output ?? 0;
				usage.cacheRead += message.usage?.cacheRead ?? 0;
				if (message.usage?.totalTokens || message.usage?.input) {
					usage.contextTokens = message.usage.totalTokens || (message.usage.input ?? 0) + (message.usage.output ?? 0) + (message.usage.cacheRead ?? 0) + (message.usage.cacheWrite ?? 0);
				}
				if (!Array.isArray(message.content)) { continue; }
				message.content.forEach((block, index) => {
					if (block.type === 'text' && block.text?.trim()) { messages.push({ id: `${entry.id}-${index}`, role: 'assistant', kind: 'text', content: block.text }); }
					else if (block.type === 'thinking' && block.thinking?.trim()) { messages.push({ id: `${entry.id}-${index}`, role: 'assistant', kind: 'thinking', content: block.thinking }); }
					else if (block.type === 'toolCall') {
						const tool: Extract<PiChatMessage, { kind: 'tool' }> = { id: `${entry.id}-${index}`, role: 'assistant', kind: 'tool', toolName: block.name ?? '', input: toolInput(block.name ?? '', block.arguments ?? {}), state: 'running' };
						messages.push(tool);
						if (block.id) { toolCalls.set(block.id, tool); }
					}
				});
				if (message.stopReason === 'error' && message.errorMessage) { messages.push({ id: `${entry.id}-error`, role: 'assistant', kind: 'notice', noticeType: 'warning', content: message.errorMessage }); }
				if (message.stopReason === 'aborted') { messages.push({ id: `${entry.id}-aborted`, role: 'assistant', kind: 'notice', noticeType: 'cancelled', content: 'Turn cancelled.' }); }
			} else if (message.role === 'custom' && message.display) {
				messages.push({ id: entry.id, role: 'assistant', kind: 'text', content: textContent(message.content as Content) });
			} else if (message.role === 'bashExecution') {
				messages.push({ id: entry.id, role: 'assistant', kind: 'tool', toolName: 'bash', input: message.command ?? '', output: message.output?.slice(0, 4000), state: message.exitCode === 0 ? 'completed' : 'failed' });
			} else if (message.role === 'toolResult') {
				const output = textContent(message.content as Content).slice(0, 4000);
				const tool = message.toolCallId ? toolCalls.get(message.toolCallId) : undefined;
				if (tool) { tool.output = output; tool.state = message.isError ? 'failed' : 'completed'; }
				else { messages.push({ id: entry.id, role: 'assistant', kind: 'tool', toolName: message.toolName ?? '', input: message.toolName ?? '', output, state: message.isError ? 'failed' : 'completed' }); }
			}
		}
		return { modelName, messages, usage };
	}
}
