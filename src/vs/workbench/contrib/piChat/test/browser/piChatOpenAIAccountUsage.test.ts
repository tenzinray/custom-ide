/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { getOpenAIAccountUsage } from '../../browser/openAIAccountUsage.js';
import { formatOpenAILimitReset } from '../../browser/openAILimitReset.js';

suite('PiChatOpenAIAccountUsage', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('requires both quotas for green and waits for the last exhausted quota to reset', () => {
		const now = 1_000_000;
		const window = (usedPercent: number, resetsAt: number) => ({ usedPercent, resetsAt });
		assert.deepStrictEqual([
			getOpenAIAccountUsage(undefined, now),
			getOpenAIAccountUsage({ updatedAt: now, fiveHour: window(10, 2000) }, now),
			getOpenAIAccountUsage({ updatedAt: now, fiveHour: window(99.9, 2000), weekly: window(50, 3000) }, now),
			getOpenAIAccountUsage({ updatedAt: now, fiveHour: window(100, 2000), weekly: window(20, 3000) }, now),
			getOpenAIAccountUsage({ updatedAt: now, fiveHour: window(20, 2000), weekly: window(100, 3000) }, now),
			getOpenAIAccountUsage({ updatedAt: now, fiveHour: window(100, 2000), weekly: window(100, 3000) }, now),
			getOpenAIAccountUsage({ updatedAt: now - 1000, fiveHour: window(100, 900), weekly: window(20, 3000) }, now),
		], [
			{ kind: 'unknown' }, { kind: 'unknown' }, { kind: 'available' },
			{ kind: 'blocked', resetsAt: 2000 }, { kind: 'blocked', resetsAt: 3000 }, { kind: 'blocked', resetsAt: 3000 }, { kind: 'unknown' },
		]);
	});

	test('uses the same minute/hour/day formatter as header quotas', () => {
		assert.deepStrictEqual([0, 60, 5400, 185400].map(seconds => formatOpenAILimitReset(seconds, 0)), ['0m', '1m', '1h 30m', '2d 3h']);
	});
});
