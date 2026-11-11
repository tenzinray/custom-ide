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
export const l10n = vscode.l10n;
export const env = vscode.env;
export const Uri = vscode.Uri;
export const ProgressLocation = vscode.ProgressLocation;
export const CancellationTokenSource = vscode.CancellationTokenSource;
export const CancellationError = vscode.CancellationError;
