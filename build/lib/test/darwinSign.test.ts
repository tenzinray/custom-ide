/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { suite, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { retryOnTransientSignError } from '../../darwin/sign.ts';

function codesignError(stderr: string): Error {
	return new Error(`Command failed: codesign --sign ABC --force --timestamp --options runtime locale.pak\nlocale.pak: ${stderr}`);
}

async function sign(failures: Error[], maxAttempts: number): Promise<{ attempts: number; result?: string; error?: string }> {
	let attempts = 0;
	try {
		const result = await retryOnTransientSignError(async () => {
			const failure = failures[attempts++];
			if (failure) {
				throw failure;
			}
			return 'signed';
		}, maxAttempts, 0);
		return { attempts, result };
	} catch (error) {
		return { attempts, error: (error as Error).message.split('\n')[1] };
	}
}

suite('darwin sign', () => {
	for (const identity of ['', 'iPhone Distribution: Example']) {
		test(`local signing rejects ${identity ? 'a mobile certificate' : 'a missing identity'} before modifying an app`, () => {
			const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../darwin/sign.ts', import.meta.url)), '..', '--local'], {
				env: { ...process.env, CODESIGN_IDENTITY: identity, AGENT_TEMPDIRECTORY: '' },
				encoding: 'utf8',
			});
			assert.equal(result.status, 1);
			assert.match(result.stderr, /Local signing requires CODESIGN_IDENTITY set to a Developer ID Application certificate name/);
		});
	}

	test('retries keychain and timestamp service errors until signing succeeds', async () => {
		assert.deepStrictEqual(await sign([
			codesignError('The specified item could not be found in the keychain.'),
			codesignError('A timestamp was expected but was not found.'),
			codesignError('The timestamp service is not available.'),
		], 5), { attempts: 4, result: 'signed' });
	});

	test('does not retry other signing errors', async () => {
		assert.deepStrictEqual(await sign([
			codesignError('code object is not signed at all'),
		], 5), { attempts: 1, error: 'locale.pak: code object is not signed at all' });
	});

	test('gives up after the maximum number of attempts', async () => {
		const timestampError = codesignError('A timestamp was expected but was not found.');
		assert.deepStrictEqual(await sign([timestampError, timestampError, timestampError], 3), { attempts: 3, error: 'locale.pak: A timestamp was expected but was not found.' });
	});
});
