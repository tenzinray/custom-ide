/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Non-secret account metadata; credentials never cross the command channel. */
export interface PiChatOpenAIAccount {
	readonly id: string;
	readonly email: string;
}

export interface PiChatOpenAIAccounts {
	readonly accounts: readonly PiChatOpenAIAccount[];
	readonly activeId: string | undefined;
	readonly busy: boolean;
}
