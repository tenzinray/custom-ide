/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, append } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DefaultStyleController, unthemedListStyles } from '../../../../../base/browser/ui/list/listWidget.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import '../../browser/media/explorerviewlet.css';

suite('Explorer project drop styling', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('project surfaces reveal native row and whole-list drop feedback and restore after dragging', () => {
		const host = append(mainWindow.document.body, $('.explorer-folders-view'));
		store.add(toDisposable(() => host.remove()));
		// Keep the pointer from accidentally activating :hover during computed-style assertions.
		host.style.cssText = 'position: fixed; left: -10000px; --vscode-sideBarTitle-background: rgb(30, 30, 30);';
		const styles = append(host, $('style'));
		new DefaultStyleController(styles, 'explorer-project-drop-test').style({ ...unthemedListStyles, listDropOverBackground: 'rgb(10, 80, 120)' });
		const list = append(host, $('.monaco-list.explorer-project-drop-test.dragging'));
		const rows = append(list, $('.monaco-list-rows'));
		const header = append(rows, $('.monaco-list-row', { 'aria-expanded': 'true' }));
		append(header, $('.monaco-tl-contents.explorer-project-header'));
		const child = append(rows, $('.monaco-list-row'));
		append(child, $('.monaco-tl-contents.explorer-project-child'));
		const surfaces = () => [header, child].map(row => mainWindow.getComputedStyle(row, '::before').backgroundColor);
		const results = [{ target: 'none', surfaces: surfaces(), feedback: '' }];
		for (const [name, target] of [['header', header], ['child', child], ['rows', rows], ['list', list]] as const) {
			target.classList.add('drop-target');
			results.push({ target: name, surfaces: surfaces(), feedback: mainWindow.getComputedStyle(target).backgroundColor });
			target.classList.remove('drop-target');
		}
		results.push({ target: 'restored', surfaces: surfaces(), feedback: '' });
		assert.deepStrictEqual(results, [
			{ target: 'none', surfaces: ['rgb(30, 30, 30)', 'rgb(30, 30, 30)'], feedback: '' },
			{ target: 'header', surfaces: ['rgba(0, 0, 0, 0)', 'rgb(30, 30, 30)'], feedback: 'rgb(10, 80, 120)' },
			{ target: 'child', surfaces: ['rgb(30, 30, 30)', 'rgba(0, 0, 0, 0)'], feedback: 'rgb(10, 80, 120)' },
			{ target: 'rows', surfaces: ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'], feedback: 'rgb(10, 80, 120)' },
			{ target: 'list', surfaces: ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'], feedback: 'rgb(10, 80, 120)' },
			{ target: 'restored', surfaces: ['rgb(30, 30, 30)', 'rgb(30, 30, 30)'], feedback: '' },
		]);
	});
});
