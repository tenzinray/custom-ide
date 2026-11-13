/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Literal prompt content shared by transcript actions and composer completions. */
export const remoteDatabasePermissionPhrase = 'I give you permission to apply this change to the remote database.';

export const piChatQuickPhrases = [
	{ trigger: 'perm', text: remoteDatabasePermissionPhrase },
	{ trigger: 'cont', text: 'continue' },
] as const;
