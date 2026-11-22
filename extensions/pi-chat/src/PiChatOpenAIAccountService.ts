/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ModelRuntime, getAgentDir } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, type Credential } from '@earendil-works/pi-ai';
// Pi does not export its file backend publicly. Reuse its exact cross-process lock and owner-only file writes.
import { FileAuthStorageBackend } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js';
import { join } from 'node:path';
import type { PiChatOpenAIAccount, PiChatOpenAIAccounts } from '../../../src/vs/workbench/contrib/piChat/common/pi-chat-openai-account-types.js';
import { isPiChatRunning, withPiChatAccountChange } from './PiChatRunService.js';
import { fetchPiChatOpenAILimitsWithToken } from './PiChatOpenAILimitsService.js';
import { PiChatOpenAIAccountLimitsService } from './PiChatOpenAIAccountLimitsService.js';

const provider = 'openai-codex';
const prefix = 'pi-chat-openai-account:';
const storage = () => new FileAuthStorageBackend(join(getAgentDir(), 'auth.json'));
let changing = false;
const accountLimits = new PiChatOpenAIAccountLimitsService(fetchPiChatOpenAILimitsWithToken);

function account(credential: Credential | undefined): PiChatOpenAIAccount | undefined {
	if (credential?.type !== 'oauth') { return undefined; }
	try {
		const claims = JSON.parse(Buffer.from(credential.access.split('.')[1], 'base64url').toString('utf8')) as {
			email?: string;
			sub?: string;
			'https://api.openai.com/profile'?: { email?: string };
			'https://api.openai.com/auth'?: { chatgpt_account_id?: string };
		};
		const accountId = typeof credential.accountId === 'string' ? credential.accountId : claims['https://api.openai.com/auth']?.chatgpt_account_id;
		const email = claims.email ?? claims['https://api.openai.com/profile']?.email;
		// A workspace can be shared by different users; keep each user's login distinct.
		const id = accountId && `${accountId}:${claims.sub ?? email ?? ''}`;
		return id ? { id, email: email ?? vscode.l10n.t('ChatGPT Account') } : undefined;
	} catch { return undefined; }
}

/** Active credentials remain in Pi's canonical provider slot; inactive logins use the same protected store. */
export async function getPiChatOpenAIAccounts(): Promise<PiChatOpenAIAccounts> {
	const credentials = new Map<string, Credential>();
	const state = await storage().withLockAsync(async content => {
		const data = JSON.parse(content ?? '{}') as Record<string, Credential>;
		const active = account(data[provider]);
		const accounts = new Map<string, PiChatOpenAIAccount>();
		for (const [key, credential] of Object.entries(data)) {
			if (key.startsWith(prefix)) { const entry = account(credential); if (entry) { accounts.set(entry.id, entry); credentials.set(entry.id, credential); } }
		}
		if (active) { accounts.set(active.id, active); credentials.set(active.id, data[provider]); }
		return { result: { accounts: [...accounts.values()], activeId: active?.id, busy: changing || isPiChatRunning() } };
	});
	accountLimits.retain(state.accounts.map(account => account.id));
	return { ...state, accounts: state.accounts.map(account => ({ ...account, limits: accountLimits.get(account.id, credentials.get(account.id)) })) };
}

async function selectAccount(id: string | undefined, credential?: Credential): Promise<void> {
	await storage().withLockAsync(async content => {
		const data = JSON.parse(content ?? '{}') as Record<string, Credential>;
		const next = credential ?? (id ? data[prefix + id] : undefined);
		if (!next || !account(next)) { throw new Error(vscode.l10n.t('This ChatGPT account is not available. Add it again.')); }
		const current = account(data[provider]);
		if (current) { data[prefix + current.id] = data[provider]; }
		data[provider] = next;
		// The active slot owns refresh-token rotation; never restore an older archived copy of it.
		delete data[prefix + account(next)!.id];
		return { result: undefined, next: JSON.stringify(data, null, 2) };
	});
}

/** One serialized account mutation; new turns cannot start during authentication or selection. */
export async function changePiChatOpenAIAccount(id?: string): Promise<void> {
	if (changing) { throw new Error(vscode.l10n.t('An account change is already in progress.')); }
	changing = true;
	try {
		await withPiChatAccountChange(async () => {
			if (id) {
				const current = await getPiChatOpenAIAccounts();
				if (current.activeId !== id) { await selectAccount(id); }
				return;
			}
			// Authenticate in isolation so cancel/failure never replaces the existing login.
			const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), refreshOnCreate: false });
			const credential = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Sign in to ChatGPT'), cancellable: true }, async (_progress, cancellation) => {
				const controller = new AbortController();
				const subscription = cancellation.onCancellationRequested(() => controller.abort());
				try {
					return await runtime.login(provider, 'oauth', {
						signal: controller.signal,
						notify: event => {
							if (event.type === 'auth_url') {
								const url = new URL(event.url);
								// Adding a login must not silently reuse the browser's current ChatGPT session.
								url.searchParams.set('prompt', 'login');
								void vscode.env.openExternal(vscode.Uri.parse(url.toString()));
							}
							else if (event.type === 'progress' || event.type === 'info') { _progress.report({ message: event.message }); }
						},
						prompt: async prompt => {
							const source = new vscode.CancellationTokenSource();
							const abort = () => source.cancel();
							const signal = prompt.signal ? AbortSignal.any([controller.signal, prompt.signal]) : controller.signal;
							signal.addEventListener('abort', abort, { once: true });
							if (signal.aborted) { source.cancel(); }
							try {
								const value = prompt.type === 'select'
									? (await vscode.window.showQuickPick(prompt.options.map(option => ({ label: option.label, id: option.id })), { title: prompt.message }, source.token))?.id
									: await vscode.window.showInputBox({ prompt: prompt.message, placeHolder: prompt.placeholder, password: prompt.type === 'secret', ignoreFocusOut: true }, source.token);
								if (value === undefined) { throw new vscode.CancellationError(); }
								return value;
							} finally { signal.removeEventListener('abort', abort); source.dispose(); }
						},
					});
				} finally { subscription.dispose(); }
			});
			await selectAccount(undefined, credential);
		});
	} finally { changing = false; }
}
