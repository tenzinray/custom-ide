/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDragAndDropData } from '../../../../../../base/browser/dnd.js';
import { IListDragAndDrop } from '../../../../../../base/browser/ui/list/list.js';
import { ExternalElementsDragAndDropData } from '../../../../../../base/browser/ui/list/listView.js';
import { URI } from '../../../../../../base/common/uri.js';
import { isWorkspaceToOpen } from '../../../../../../platform/window/common/window.js';
import { ProjectEntry } from './project-entry.js';

/** Projects are drag sources only; action rows and saved workspaces are not folders. */
export class ProjectsDragAndDrop implements IListDragAndDrop<ProjectEntry | string> {
	getDragURI(entry: ProjectEntry | string): string | null {
		return typeof entry === 'string' || isWorkspaceToOpen(entry) ? null : entry.folderUri.toString();
	}

	getDragLabel(entries: (ProjectEntry | string)[]): string | undefined {
		return entries.length === 1 && typeof entries[0] !== 'string' ? entries[0].name : undefined;
	}

	onDragOver(): boolean { return false; }
	drop(): void { }
	dispose(): void { }
}

/** Only folder entries from another workbench list can be added as workspace roots. */
export function getDraggedProjectFolders(data: IDragAndDropData): URI[] {
	if (!(data instanceof ExternalElementsDragAndDropData)) {
		return [];
	}
	const entries: readonly unknown[] = data.elements;
	if (!entries.length || !entries.every((entry): entry is ProjectEntry & { folderUri: URI } =>
		typeof entry === 'object' && entry !== null && 'name' in entry && typeof entry.name === 'string'
		&& 'folderUri' in entry && URI.isUri(entry.folderUri) && !('workspaceUri' in entry))) {
		return [];
	}
	return entries.map(entry => entry.folderUri);
}
