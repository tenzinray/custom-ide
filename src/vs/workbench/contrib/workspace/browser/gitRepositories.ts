/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { getProjectsDirectory } from '../../../../platform/workspaces/common/projectDirectories.js';

export interface GitRepository {
	readonly name: string;
	readonly folderUri: URI;
}

/** Shared project choices: direct ~/Documents/VSCode repositories and the ~/.pi repository. */
export async function listGitRepositories(userHome: URI, fileService: IFileService): Promise<GitRepository[]> {
	const directory = await fileService.resolve(getProjectsDirectory(userHome)).catch(error => {
		if (toFileOperationResult(error) !== FileOperationResult.FILE_NOT_FOUND) { throw error; }
		return undefined;
	});
	const candidates = [...(directory?.children ?? []).filter(child => child.isDirectory).map(child => child.resource), joinPath(userHome, '.pi')];
	const repos = await Promise.all(candidates.map(async folderUri =>
		await fileService.exists(joinPath(folderUri, '.git')) ? { name: basename(folderUri), folderUri } : undefined));
	return repos.filter(repo => repo !== undefined).sort((a, b) => a.name.localeCompare(b.name));
}
