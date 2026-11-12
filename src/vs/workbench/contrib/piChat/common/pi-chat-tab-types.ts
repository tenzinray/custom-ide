/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PiChatSessionSummary } from './pi-chat-types.js';

/** Inline setup has a tab identity before a repository or runtime session exists. */
export interface PiChatNewChatTab {
	readonly id: string;
	readonly isNewChat: true;
}

export type PiChatTab = PiChatSessionSummary | PiChatNewChatTab;

export function isPiChatSessionTab(tab: PiChatTab): tab is PiChatSessionSummary {
	return !('isNewChat' in tab);
}
