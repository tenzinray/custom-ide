/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PiChatOpenAILimits } from './pi-chat-openai-limits-types.js';

/** Non-secret account metadata; credentials never cross the command channel. */
export interface PiChatOpenAIAccount {
	readonly id: string;
	readonly email: string;
	readonly limits?: PiChatOpenAILimits;
}

export interface PiChatOpenAIAccounts {
	readonly accounts: readonly PiChatOpenAIAccount[];
	readonly activeId: string | undefined;
	readonly busy: boolean;
}
