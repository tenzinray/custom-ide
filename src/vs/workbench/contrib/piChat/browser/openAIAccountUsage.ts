/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PiChatOpenAILimits } from '../common/pi-chat-openai-limits-types.js';

/** One account is usable only when both quotas are known; all blocking quotas must reset. */
export function getOpenAIAccountUsage(limits: PiChatOpenAILimits | undefined, now = Date.now()) {
	if (!limits?.fiveHour || !limits.weekly) { return { kind: 'unknown' } as const; }
	const blocked = [limits.fiveHour, limits.weekly].filter(window => window.usedPercent >= 100);
	const waiting = blocked.filter(window => window.resetsAt * 1000 > now);
	if (waiting.length) { return { kind: 'blocked', resetsAt: Math.max(...waiting.map(window => window.resetsAt)) } as const; }
	// A passed reset is not proof of fresh quota; wait for the next account-specific fetch.
	return blocked.length ? { kind: 'unknown' } as const : { kind: 'available' } as const;
}
