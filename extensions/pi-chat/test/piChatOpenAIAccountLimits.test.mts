/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import type { Credential } from '@earendil-works/pi-ai';
import type { PiChatOpenAILimits } from '../../../src/vs/workbench/contrib/piChat/common/pi-chat-openai-limits-types.js';
import { PiChatOpenAIAccountLimitsService } from '../src/PiChatOpenAIAccountLimitsService.ts';
import { activatePiChatTestExtension } from './piChatExtensionTestHost.mts';
import type { PiChatOpenAIAccounts } from '../../../src/vs/workbench/contrib/piChat/common/pi-chat-openai-account-types.js';

const credential = (access: string, expires: number): Credential => ({ type: 'oauth', access, refresh: 'fixture-refresh', expires });
const quota = (usedPercent: number): PiChatOpenAILimits => ({ updatedAt: 1000, fiveHour: { usedPercent, resetsAt: 9000 }, weekly: { usedPercent, resetsAt: 10000 } });

test('the registered account command returns metadata without changing credentials or selecting another login', async () => {
	const root = await mkdtemp(join(tmpdir(), 'pi-chat-account-quotas-'));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	const token = (email: string, workspace: string) => `e30.${Buffer.from(JSON.stringify({ email, sub: email, 'https://api.openai.com/auth': { chatgpt_account_id: workspace } })).toString('base64url')}.signature`;
	const auth = JSON.stringify({
		'openai-codex': credential(token('active@example.test', 'active-workspace'), 0),
		'pi-chat-openai-account:other-workspace:other@example.test': credential(token('other@example.test', 'other-workspace'), 0),
	});
	await writeFile(join(root, 'auth.json'), auth);
	const host = await activatePiChatTestExtension();
	try {
		const state = await host.commands.get('piChat.openAIAccounts')!() as PiChatOpenAIAccounts;
		assert.deepStrictEqual({ active: state.activeId, emails: state.accounts.map(account => account.email).sort(), auth: await readFile(join(root, 'auth.json'), 'utf8'), leakedRefresh: JSON.stringify(state).includes('fixture-refresh') }, {
			active: 'active-workspace:active@example.test', emails: ['active@example.test', 'other@example.test'], auth, leakedRefresh: false,
		});
	} finally {
		host.dispose();
		if (previousAgentDir === undefined) { delete process.env.PI_CODING_AGENT_DIR; } else { process.env.PI_CODING_AGENT_DIR = previousAgentDir; }
		await rm(root, { recursive: true, force: true });
	}
});

test('quotas belong to each login and concurrent polls share one request', async () => {
	const calls: string[] = [];
	const cache = new PiChatOpenAIAccountLimitsService(async token => { calls.push(token); return quota(token === 'a' ? 10 : 100); }, () => 1000);
	const a = credential('a', 100000);
	const b = credential('b', 100000);
	cache.get('account-a', a);
	cache.get('account-a', a);
	cache.get('account-b', b);
	await setImmediate();
	assert.deepStrictEqual({ calls, a: cache.get('account-a', a)?.fiveHour?.usedPercent, b: cache.get('account-b', b)?.fiveHour?.usedPercent, unchanged: a }, {
		calls: ['a', 'b'], a: 10, b: 100, unchanged: credential('a', 100000),
	});
});

test('passes the stored workspace identity with that login’s access token', async () => {
	let workspace: string | undefined;
	const cache = new PiChatOpenAIAccountLimitsService(async (_token, accountId) => { workspace = accountId; return quota(10); }, () => 1000);
	cache.get('workspace:user', { type: 'oauth', access: 'fixture', refresh: 'fixture-refresh', expires: 100000, accountId: 'workspace' });
	await setImmediate();
	assert.strictEqual(workspace, 'workspace');
});

test('expired credentials stay unknown and failures are throttled without touching authentication', async () => {
	let now = 1000;
	let calls = 0;
	let fail = false;
	const cache = new PiChatOpenAIAccountLimitsService(async () => { calls++; if (fail) { throw new Error('fixture failure'); } return quota(10); }, () => now);
	const login = credential('a', 1000000);
	cache.get('a', login);
	await setImmediate();
	fail = true;
	now += 60_000;
	cache.get('a', login);
	await setImmediate();
	assert.deepStrictEqual({ failed: cache.get('a', login), expired: cache.get('expired', credential('expired', now)), calls }, { failed: undefined, expired: undefined, calls: 2 });
});

test('rotated tokens do not inherit an old in-flight quota result', async () => {
	let resolveOld!: (limits: PiChatOpenAILimits) => void;
	const cache = new PiChatOpenAIAccountLimitsService(token => token === 'old' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(quota(20)), () => 1000);
	cache.get('a', credential('old', 100000));
	cache.get('a', credential('new', 100000));
	await setImmediate();
	resolveOld(quota(100));
	await setImmediate();
	assert.strictEqual(cache.get('a', credential('new', 100000))?.fiveHour?.usedPercent, 20);
	cache.retain([]);
	assert.strictEqual(cache.get('a', credential('new', 100000)), undefined);
	await setImmediate();
});
