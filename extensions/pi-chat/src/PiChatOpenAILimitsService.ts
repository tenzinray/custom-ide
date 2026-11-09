/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { PiChatOpenAILimits, PiChatOpenAILimitWindow } from '../../../src/vs/workbench/contrib/piChat/common/pi-chat-openai-limits-types.js';

interface UsageWindow {
	used_percent?: number;
	limit_window_seconds?: number;
	reset_at?: number;
}

function toLimitWindow(value: UsageWindow | undefined): PiChatOpenAILimitWindow | undefined {
	if (!value || !Number.isFinite(value.used_percent) || !Number.isFinite(value.reset_at) || value.reset_at! < 0 || value.reset_at! > 32_503_680_000) { return undefined; }
	return { usedPercent: Math.max(0, Math.min(100, value.used_percent!)), resetsAt: value.reset_at! };
}

/** Fetches the account-wide Codex subscription quota without sending a model prompt. */
export async function fetchPiChatOpenAILimits(): Promise<PiChatOpenAILimits | undefined> {
	const runtime = await ModelRuntime.create({ refreshOnCreate: false });
	const auth = await runtime.getAuth('openai-codex');
	// OpenAI API keys have different limits; never present them as ChatGPT 5-hour/weekly usage.
	if (auth?.source !== 'OAuth' || !auth.auth.apiKey) { return undefined; }
	const headers: Record<string, string> = { Authorization: `Bearer ${auth.auth.apiKey}` };
	try {
		const claims = JSON.parse(Buffer.from(auth.auth.apiKey.split('.')[1], 'base64url').toString('utf8')) as { 'https://api.openai.com/auth'?: { chatgpt_account_id?: string } };
		const accountId = claims['https://api.openai.com/auth']?.chatgpt_account_id;
		if (accountId) { headers['ChatGPT-Account-Id'] = accountId; }
	} catch { /* Some access tokens are opaque. */ }
	const response = await fetch('https://chatgpt.com/backend-api/wham/usage', { headers, signal: AbortSignal.timeout(12_000) });
	if (!response.ok) { throw new Error(`OpenAI usage request failed (${response.status}).`); }
	const data = await response.json() as { rate_limit?: { primary_window?: UsageWindow; secondary_window?: UsageWindow } };
	const windows = [data.rate_limit?.primary_window, data.rate_limit?.secondary_window];
	const fiveHour = toLimitWindow(windows.find(window => window?.limit_window_seconds === 300 * 60));
	const weekly = toLimitWindow(windows.find(window => window?.limit_window_seconds === 7 * 24 * 60 * 60));
	if (!fiveHour && !weekly) { throw new Error('OpenAI did not return a 5-hour or weekly usage window.'); }
	return { fiveHour, weekly, updatedAt: Date.now() };
}
