/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullFilesConfigurationService, TestFileService } from '../../../../test/common/workbenchTestServices.js';
import { ExplorerProjectActions } from '../../browser/views/ExplorerProjectActions.js';
import { ExplorerItem } from '../../common/explorerModel.js';

suite('Files - Explorer Project Actions', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('starts a project-scoped chat before collapse without toggling the tree row', () => {
		const host = document.createElement('div');
		const project = new ExplorerItem(URI.file('/project'), new TestFileService(), new TestConfigurationService(), NullFilesConfigurationService, undefined, true);
		const calls: ExplorerItem[] = [];
		host.onclick = () => assert.fail('Toolbar clicks must not reach the tree row');
		const commands: { id: string; resource: URI }[] = [];
		const commandService = upcastPartial<ICommandService>({ executeCommand: async (id: string, resource: URI) => { commands.push({ id, resource }); return undefined; } });
		const actions = store.add(new ExplorerProjectActions(host, project, target => { calls.push(target); }, commandService));
		assert.strictEqual(host.querySelectorAll('.action-label').length, 2);
		for (const button of host.querySelectorAll<HTMLElement>('.action-label')) {
			button.click();
		}
		assert.deepStrictEqual({ calls, commands }, { calls: [project], commands: [{ id: 'piChat.newChat', resource: project.resource }] });
		actions.dispose();
		assert.strictEqual(host.childElementCount, 0);
	});
});
