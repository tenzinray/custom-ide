/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { calculateContextTokens, getLastAssistantUsage, getLatestCompactionEntry, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import type { PiChatContextUsage } from '../../../src/vs/workbench/contrib/piChat/common/pi-chat-context-usage-types.js';
import { checkSessionFile, getPiChatActiveContextUsage } from './PiChatRunService.js';

/** Read-only context usage for saved chats; active runs use Pi's own estimate directly. */
export async function getPiChatContextUsage(id: string, file: string, cwd: string): Promise<PiChatContextUsage | undefined> {
	const active = getPiChatActiveContextUsage(id);
	if (active) { return active; }
	const manager = SessionManager.open(await checkSessionFile(id, file, cwd));
	const modelId = manager.buildSessionContext().model;
	if (!modelId) { return undefined; }
	const runtime = await ModelRuntime.create({ refreshOnCreate: false });
	const model = runtime.getModel(modelId.provider, modelId.modelId);
	if (!model?.contextWindow) { return undefined; }
	const branch = manager.getBranch();
	const compaction = getLatestCompactionEntry(branch);
	// The last pre-compaction response describes the *old* context, not the new one.
	const usage = getLastAssistantUsage(compaction ? branch.slice(branch.indexOf(compaction) + 1) : branch);
	const tokens = usage ? calculateContextTokens(usage) : null;
	return { tokens, contextWindow: model.contextWindow, percent: tokens === null ? null : tokens / model.contextWindow * 100 };
}
