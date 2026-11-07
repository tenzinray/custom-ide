/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../base/browser/dom.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { GettingStartedIndexList } from './gettingStartedList.js';

export interface IWelcomeRepo {
	readonly id: string;
	readonly name: string;
	readonly folderUri: URI;
}

/** Lists direct Git repositories in the same ~/Documents/VSCode directory used by Pi UI. */
export function createGettingStartedRepoList(userHome: URI, fileService: IFileService, hostService: IHostService, contextService: IContextKeyService): GettingStartedIndexList<IWelcomeRepo> {
	const reposDirectory = joinPath(userHome, 'Documents', 'VSCode');
	const empty = $('li', {}, localize('welcomePage.noRepos', "No Git repositories found in Documents/VSCode."));
	const list = new GettingStartedIndexList<IWelcomeRepo>({
		title: localize('welcomePage.repos', "Repos"),
		klass: 'repo-list',
		limit: Number.MAX_SAFE_INTEGER,
		empty,
		renderElement: repo => {
			const button = $('button.button-link', { title: repo.folderUri.fsPath }, repo.name);
			button.setAttribute('aria-label', localize('welcomePage.openRepo', "Open repository {0}", repo.name));
			button.addEventListener('click', e => {
				hostService.openWindow([{ folderUri: repo.folderUri }], { forceNewWindow: e.ctrlKey || e.metaKey });
			});
			return $('li', {}, button);
		},
		contextService
	});

	void (async () => {
		try {
			const directory = await fileService.resolve(reposDirectory);
			const repos = await Promise.all((directory.children ?? []).filter(child => child.isDirectory).map(async child =>
				await fileService.exists(joinPath(child.resource, '.git')) ? { id: child.resource.toString(), name: child.name, folderUri: child.resource } : undefined));
			list.setEntries(repos.filter(repo => repo !== undefined).sort((a, b) => a.name.localeCompare(b.name)));
		} catch {
			list.setEntries([]);
		}
	})();

	return list;
}
