/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface PiChatRunTool {
	id: string;
	role: 'assistant';
	kind: 'tool';
	toolName: string;
	input: string;
	output?: string;
	state: 'running' | 'completed' | 'failed';
}

/** Events transported from Pi's extension-host runtime to the workbench. */
export type PiChatRunEvent =
	| { type: 'delta'; id: string; kind: 'text' | 'thinking'; delta: string }
	| { type: 'tool'; message: PiChatRunTool }
	| { type: 'queuedSent'; prompt: PiChatQueuedPrompt }
	| { type: 'activity' }
	| { type: 'complete' }
	| { type: 'error'; message: string };

export interface PiChatQueuedPrompt {
	readonly id: string;
	readonly text: string;
}

export interface PiChatRunSnapshot {
	readonly events: PiChatRunEvent[];
	readonly nextIndex: number;
	readonly running: boolean;
	readonly queued: PiChatQueuedPrompt[];
}

export interface PiChatCreatedSession {
	readonly id: string;
	readonly sessionFile: string;
}
