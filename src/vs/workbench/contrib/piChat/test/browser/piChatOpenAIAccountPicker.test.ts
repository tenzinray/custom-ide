/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { timeout } from '../../../../../base/common/async.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IContextViewDelegate, IContextViewService, IOpenContextView } from '../../../../../platform/contextview/browser/contextView.js';
import { PiChatOpenAIAccountPicker } from '../../browser/footer/PiChatOpenAIAccountPicker.js';
import { PiChatOpenAIAccount } from '../../common/pi-chat-openai-account-types.js';

suite('PiChatOpenAIAccountPicker', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function contextViews(): IContextViewService {
		return new class extends mock<IContextViewService>() {
			override showContextView(delegate: IContextViewDelegate): IOpenContextView {
				const container = mainWindow.document.createElement('div');
				mainWindow.document.body.append(container);
				const rendering = delegate.render(container);
				let closed = false;
				const view = { close: () => { if (!closed) { closed = true; delegate.onHide?.(); rendering.dispose(); container.remove(); } } };
				store.add(toDisposable(() => view.close()));
				delegate.focus?.();
				return view;
			}
		}();
	}

	test('shows only the username when closed and full emails in the account menu', async () => {
		const host = mainWindow.document.createElement('div');
		const selections: (string | undefined)[] = [];
		const picker = store.add(new PiChatOpenAIAccountPicker(host, id => selections.push(id), contextViews()));
		picker.update({ activeId: 'a', accounts: [{ id: 'a', email: 'a@example.test' }, { id: 'b', email: 'b@example.test' }], busy: false });
		const button = host.querySelector<HTMLButtonElement>('button')!;
		button.click();
		const labels = Array.from(mainWindow.document.querySelectorAll<HTMLElement>('.pi-chat-account-menu .action-label'));
		assert.deepStrictEqual({ username: host.querySelector('.pi-chat-account-label')?.textContent, disabled: button.disabled, labels: labels.map(label => label.textContent), buttonStatus: host.querySelector('.pi-chat-account-usage') }, {
			username: 'a', disabled: false, labels: ['a@example.test', 'b@example.test', 'Add ChatGPT Account…'], buttonStatus: null,
		});
		labels[1].click();
		await timeout(0);
		button.click();
		mainWindow.document.querySelector<HTMLElement>('.pi-chat-account-menu .action-item:last-child .action-label')!.click();
		await timeout(0);
		assert.deepStrictEqual({ selections, username: host.querySelector('.pi-chat-account-label')?.textContent }, { selections: ['b', undefined], username: 'a' });
	});

	test('shows account-specific usage only in menu rows and updates an open menu', () => {
		const host = mainWindow.document.createElement('div');
		const picker = store.add(new PiChatOpenAIAccountPicker(host, () => {}, contextViews()));
		const now = Date.now();
		const reset = Math.floor(now / 1000) + 5400;
		const accounts: PiChatOpenAIAccount[] = [
			{ id: 'ready', email: 'ready@example.test', limits: { updatedAt: now, fiveHour: { usedPercent: 50, resetsAt: reset }, weekly: { usedPercent: 30, resetsAt: reset } } },
			{ id: 'blocked', email: 'blocked@example.test', limits: { updatedAt: now, fiveHour: { usedPercent: 100, resetsAt: reset }, weekly: { usedPercent: 30, resetsAt: reset * 2 } } },
			{ id: 'unknown', email: 'unknown@example.test' },
		];
		picker.update({ activeId: 'ready', accounts, busy: false });
		host.querySelector<HTMLButtonElement>('button')!.click();
		const rows = () => Array.from(mainWindow.document.querySelectorAll('.pi-chat-account-menu-row'), row => ({ email: row.querySelector('.action-label')?.textContent, available: !!row.querySelector('.pi-chat-account-usage-available.codicon-check'), countdown: row.querySelector('.pi-chat-account-usage-blocked')?.textContent, unknown: !!row.querySelector('.pi-chat-account-usage-unknown') }));
		assert.deepStrictEqual(rows(), [
			{ email: 'ready@example.test', available: true, countdown: undefined, unknown: false },
			{ email: 'blocked@example.test', available: false, countdown: '1h 30m', unknown: false },
			{ email: 'unknown@example.test', available: false, countdown: undefined, unknown: true },
		]);
		picker.update({ activeId: 'ready', accounts: accounts.map(account => ({ ...account, limits: accounts[0].limits })), busy: false });
		assert.strictEqual(rows().every(row => row.available && row.countdown === undefined), true);
		assert.strictEqual(host.querySelector('.pi-chat-account-usage'), null);
	});

	test('supports keyboard selection and restores the closed button focus', async () => {
		const host = mainWindow.document.createElement('div');
		mainWindow.document.body.append(host);
		store.add(toDisposable(() => host.remove()));
		const selections: (string | undefined)[] = [];
		const picker = store.add(new PiChatOpenAIAccountPicker(host, id => selections.push(id), contextViews()));
		picker.update({ activeId: 'a', accounts: [{ id: 'a', email: 'a@example.test' }, { id: 'b', email: 'b@example.test' }], busy: false });
		const button = host.querySelector<HTMLButtonElement>('button')!;
		button.click();
		mainWindow.document.activeElement!.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
		mainWindow.document.activeElement!.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
		mainWindow.document.activeElement!.dispatchEvent(new mainWindow.KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
		await timeout(0);
		assert.deepStrictEqual({ selections, expanded: button.getAttribute('aria-expanded'), focused: mainWindow.document.activeElement === button }, { selections: ['b'], expanded: 'false', focused: true });
	});

	test('disables selection during turns/authentication and closes an open menu when busy', () => {
		const host = mainWindow.document.createElement('div');
		const picker = store.add(new PiChatOpenAIAccountPicker(host, () => {}, contextViews()));
		const button = host.querySelector<HTMLButtonElement>('button')!;
		assert.strictEqual(button.disabled, false);
		picker.update({ activeId: undefined, accounts: [], busy: false });
		button.click();
		assert.strictEqual(button.getAttribute('aria-expanded'), 'true');
		picker.setBusy(true);
		assert.deepStrictEqual({ disabled: button.disabled, expanded: button.getAttribute('aria-expanded') }, { disabled: true, expanded: 'false' });
		picker.update({ activeId: undefined, accounts: [], busy: false });
		assert.strictEqual(button.disabled, true);
		picker.setBusy(false);
		picker.update({ activeId: undefined, accounts: [], busy: true });
		assert.strictEqual(button.disabled, true);
		picker.update({ activeId: undefined, accounts: [], busy: false });
		assert.strictEqual(button.disabled, false);
	});
});
