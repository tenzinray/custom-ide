/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { PiChatOpenAIAccountPicker } from '../../browser/footer/PiChatOpenAIAccountPicker.js';

suite('PiChatOpenAIAccountPicker', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('shows only the username when closed and full emails in the account menu', () => {
		const host = mainWindow.document.createElement('div');
		const selections: (string | undefined)[] = [];
		const picker = store.add(new PiChatOpenAIAccountPicker(host, id => selections.push(id)));
		picker.update({ activeId: 'a', accounts: [{ id: 'a', email: 'a@example.test' }, { id: 'b', email: 'b@example.test' }], busy: false });
		const select = host.querySelector('select')!;
		assert.deepStrictEqual({ username: host.querySelector('.pi-chat-account-label')?.textContent, value: select.value, disabled: select.disabled, labels: Array.from(select.options, option => option.textContent) }, {
			username: 'a', value: 'a', disabled: false, labels: ['a@example.test', 'b@example.test', 'Add ChatGPT Account…'],
		});
		select.value = 'b';
		select.dispatchEvent(new mainWindow.Event('change'));
		select.value = '';
		select.dispatchEvent(new mainWindow.Event('change'));
		assert.deepStrictEqual({ selections, value: select.value }, { selections: ['b', undefined], value: 'a' });
	});

	test('disables selection during any chat turn or authentication, and enables adding the first account', () => {
		const host = mainWindow.document.createElement('div');
		const picker = store.add(new PiChatOpenAIAccountPicker(host, () => {}));
		const select = host.querySelector('select')!;
		assert.deepStrictEqual({ disabled: select.disabled, label: select.options[0].textContent }, { disabled: false, label: 'Loading ChatGPT Account…' });
		picker.update({ activeId: undefined, accounts: [], busy: false });
		assert.deepStrictEqual({ disabled: select.disabled, labels: Array.from(select.options, option => option.textContent) }, {
			disabled: false, labels: ['ChatGPT Account', 'Add ChatGPT Account…'],
		});
		picker.setBusy(true);
		assert.strictEqual(select.disabled, true);
		picker.update({ activeId: undefined, accounts: [], busy: false });
		assert.strictEqual(select.disabled, true);
		picker.setBusy(false);
		picker.update({ activeId: undefined, accounts: [], busy: true });
		assert.strictEqual(select.disabled, true);
		picker.update({ activeId: undefined, accounts: [], busy: false });
		assert.strictEqual(select.disabled, false);
	});
});
