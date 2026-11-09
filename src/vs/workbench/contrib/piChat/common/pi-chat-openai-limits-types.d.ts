/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** ChatGPT Codex subscription windows; percentages are used, not remaining. */
export interface PiChatOpenAILimitWindow {
	readonly usedPercent: number;
	readonly resetsAt: number;
}

export interface PiChatOpenAILimits {
	readonly fiveHour?: PiChatOpenAILimitWindow;
	readonly weekly?: PiChatOpenAILimitWindow;
	readonly updatedAt: number;
}
