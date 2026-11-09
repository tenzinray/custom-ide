/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { PiChatRunTool } from './pi-chat-run-types.js';
import { PiChatContextUsage } from './pi-chat-context-usage-types.js';

/** Metadata only; conversation messages are intentionally not loaded in the sidebar. */
export interface PiChatSessionSummary {
	readonly id: string;
	readonly repoName: string;
	readonly repoPath: string;
	readonly lastMessageAt: string;
	readonly sessionFile: URI;
	readonly isDraft?: boolean;
}

/** Read-only saved-session display contract, matching Pi UI's message kinds. */
export type PiChatMessage =
	| { id: string; role: 'user'; content: string }
	| { id: string; role: 'assistant'; kind: 'text'; content: string }
	| { id: string; role: 'assistant'; kind: 'thinking'; content: string }
	| PiChatRunTool
	| { id: string; role: 'assistant'; kind: 'notice'; noticeType: 'compaction' | 'branchSummary' | 'warning' | 'cancelled'; content: string };

export interface PiChatSessionHistory {
	readonly modelName: string;
	readonly messages: PiChatMessage[];
	readonly usage: { input: number; output: number; cacheRead: number };
	contextUsage?: PiChatContextUsage;
}
