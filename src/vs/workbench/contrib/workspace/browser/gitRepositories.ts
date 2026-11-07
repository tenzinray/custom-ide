/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';

/** Direct Git repositories in the ~/Documents/VSCode folder used by Pi UI. */
export async function listGitRepositories(userHome: URI, fileService: IFileService): Promise<{ name: string; folderUri: URI }[]> {
	const directory = await fileService.resolve(joinPath(userHome, 'Documents', 'VSCode'));
	const repos = await Promise.all((directory.children ?? []).filter(child => child.isDirectory).map(async child =>
		await fileService.exists(joinPath(child.resource, '.git')) ? { name: child.name, folderUri: child.resource } : undefined));
	return repos.filter(repo => repo !== undefined).sort((a, b) => a.name.localeCompare(b.name));
}
