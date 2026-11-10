/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DataTransfers } from '../../../../../base/browser/dnd.js';
import { extractEditorsDropData } from '../../../../../platform/dnd/browser/dnd.js';
import { PiChatPromptEditor } from '../../../piChat/browser/footer/PiChatPromptEditor.js';
import { ElementsDragAndDropData, ExternalElementsDragAndDropData, NativeDragAndDropData } from '../../../../../base/browser/ui/list/listView.js';
import { ListDragOverEffectPosition, ListDragOverEffectType } from '../../../../../base/browser/ui/list/list.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IWorkspaceFolderCreationData } from '../../../../../platform/workspaces/common/workspaces.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IWorkspaceEditingService } from '../../../../services/workspaces/common/workspaceEditing.js';
import { FileDragAndDrop } from '../../browser/views/explorerViewer.js';
import { getDraggedProjectFolders, ProjectsDragAndDrop } from '../../browser/views/projects/projectDragAndDrop.js';

suite('Files - Project Drag and Drop', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const project = { name: 'Project', folderUri: URI.file('/projects/project') };
	const workspace = { name: 'Workspace', workspaceUri: URI.file('/workspaces/example.code-workspace') };

	test('only project folders are draggable', () => {
		const source = store.add(new ProjectsDragAndDrop());
		assert.deepStrictEqual([
			source.getDragURI(project), source.getDragURI(workspace), source.getDragURI('select-folder'), source.onDragOver(),
		], [project.folderUri.toString(), null, null, false]);
	});

	test('project drags use the standard resource payload and insert the full path into Pi chat', () => {
		const source = store.add(new ProjectsDragAndDrop());
		const dataTransfer = new DataTransfer();
		const event = new DragEvent('dragstart', { dataTransfer });
		source.onDragStart(new ElementsDragAndDropData([project]), event);
		const resources = extractEditorsDropData(event).flatMap(editor => editor.resource ? [editor.resource] : []);
		const host = document.body.appendChild(document.createElement('div'));
		try {
			const prompt = store.add(new PiChatPromptEditor(host, false, 'Type here...'));
			prompt.insertFiles(resources);
			assert.deepStrictEqual({ payload: dataTransfer.getData(DataTransfers.RESOURCES), text: prompt.value }, {
				payload: JSON.stringify([project.folderUri.toString()]), text: `[project](${project.folderUri.toString()}) `,
			});
		} finally { host.remove(); }
	});

	test('only external project folder entries are recognized', () => {
		assert.deepStrictEqual([
			getDraggedProjectFolders(new ExternalElementsDragAndDropData([project])),
			getDraggedProjectFolders(new ExternalElementsDragAndDropData([workspace])),
			getDraggedProjectFolders(new ExternalElementsDragAndDropData([project, workspace])),
			getDraggedProjectFolders(new ExternalElementsDragAndDropData(['select-folder'])),
			getDraggedProjectFolders(new ExternalElementsDragAndDropData([{ resource: project.folderUri }])),
			getDraggedProjectFolders(new ElementsDragAndDropData([project])),
			getDraggedProjectFolders(new NativeDragAndDropData()),
		], [[project.folderUri], [], [], [], [], [], []]);
	});

	for (const enabled of [true, false]) {
		test(`project drop adds a workspace folder only when drag and drop is enabled (${enabled})`, async () => {
			const instantiationService = workbenchInstantiationService(undefined, store);
			instantiationService.stub(IConfigurationService, new TestConfigurationService({ explorer: { enableDragAndDrop: enabled } }));
			const added: IWorkspaceFolderCreationData[][] = [];
			instantiationService.stub(IWorkspaceEditingService, new class extends mock<IWorkspaceEditingService>() {
				override async addFolders(folders: IWorkspaceFolderCreationData[]): Promise<void> { added.push(folders); }
			}());
			const target = store.add(instantiationService.createInstance(FileDragAndDrop, () => false));
			const data = new ExternalElementsDragAndDropData([project]);
			const event = new DragEvent('drop');
			const reaction = target.onDragOver(data, undefined, undefined, undefined, event);
			// An empty tree must work too: no existing root or file-operation target is required.
			await target.drop(data, undefined, undefined, undefined, event);
			assert.deepStrictEqual({ reaction, added }, enabled ? {
				reaction: { accept: true, effect: { type: ListDragOverEffectType.Copy, position: ListDragOverEffectPosition.Over }, feedback: [-1] },
				added: [[{ uri: project.folderUri }]],
			} : { reaction: false, added: [] });
		});
	}
});
