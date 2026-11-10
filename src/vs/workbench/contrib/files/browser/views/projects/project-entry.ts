/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import { IFolderToOpen, IWorkspaceToOpen, isWorkspaceToOpen } from '../../../../../../platform/window/common/window.js';

/** Named native open targets shared by Projects discovery and list presentation. */
export type ProjectEntry = (IFolderToOpen | IWorkspaceToOpen) & { readonly name: string };

export function getProjectResource(entry: ProjectEntry): URI {
	return isWorkspaceToOpen(entry) ? entry.workspaceUri : entry.folderUri;
}
