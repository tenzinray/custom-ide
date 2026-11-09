/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'node:module';
import type * as Vscode from 'vscode';

const vscode = createRequire(import.meta.url)('vscode') as typeof Vscode;
export const commands = vscode.commands;
export const window = vscode.window;
export const workspace = vscode.workspace;
