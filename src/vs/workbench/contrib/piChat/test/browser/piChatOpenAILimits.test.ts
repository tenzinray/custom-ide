/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { PiChatOpenAILimitsService } from '../../browser/PiChatOpenAILimitsService.js';
import { PiChatOpenAILimits } from '../../common/pi-chat-openai-limits-types.js';

suite('PiChatOpenAILimits Account Changes', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('clears old usage immediately and ignores a previous account request still in flight', async () => {
		const oldRequest = new DeferredPromise<PiChatOpenAILimits>();
		const newRequest = new DeferredPromise<PiChatOpenAILimits>();
		const requests = [oldRequest, newRequest];
		const commands = new class extends mock<ICommandService>() {
			override executeCommand<T>(): Promise<T> { return requests.shift()!.p as Promise<T>; }
		}();
		const service = store.add(new PiChatOpenAILimitsService(commands));
		const oldLoad = service.refresh();
		service.invalidate();
		const newLoad = service.refresh();
		assert.deepStrictEqual({ limits: service.limits, refreshing: service.refreshing }, { limits: undefined, refreshing: true });
		await oldRequest.complete({ fiveHour: { usedPercent: 90, resetsAt: 100 }, updatedAt: 1 });
		await oldLoad;
		assert.deepStrictEqual({ limits: service.limits, refreshing: service.refreshing }, { limits: undefined, refreshing: true });
		const limits: PiChatOpenAILimits = { fiveHour: { usedPercent: 10, resetsAt: 200 }, updatedAt: 2 };
		await newRequest.complete(limits);
		await newLoad;
		assert.deepStrictEqual({ limits: service.limits, refreshing: service.refreshing, error: service.error }, { limits, refreshing: false, error: undefined });
	});
});
