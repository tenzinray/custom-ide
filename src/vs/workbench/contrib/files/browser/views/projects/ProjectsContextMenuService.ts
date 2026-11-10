/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IListContextMenuEvent } from '../../../../../../base/browser/ui/list/list.js';
import { toAction } from '../../../../../../base/common/actions.js';
import { isMacintosh, isWindows } from '../../../../../../base/common/platform.js';
import { localize } from '../../../../../../nls.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IContextMenuService } from '../../../../../../platform/contextview/browser/contextView.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { isWorkspaceToOpen } from '../../../../../../platform/window/common/window.js';
import { IWorkspaceEditingService } from '../../../../../services/workspaces/common/workspaceEditing.js';
import { getProjectResource, ProjectEntry } from './project-entry.js';

/** Project context actions reuse the same chat, workspace, and OS commands as Explorer files. */
export class ProjectsContextMenuService {
	constructor(
		@IContextMenuService private readonly contextMenus: IContextMenuService,
		@ICommandService private readonly commands: ICommandService,
		@IWorkspaceEditingService private readonly workspaceEditing: IWorkspaceEditingService,
		@INotificationService private readonly notifications: INotificationService,
	) { }

	show(entry: ProjectEntry, anchor: IListContextMenuEvent<ProjectEntry>['anchor']): void {
		const resource = getProjectResource(entry);
		const run = async (action: () => Promise<unknown>): Promise<void> => {
			try { await action(); }
			catch (error) { this.notifications.error(error); }
		};
		this.contextMenus.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => [
				toAction({ id: 'projects.addPathToChat', label: localize('projects.addPathToChat', "Add Path to Chat"), run: () => run(() => this.commands.executeCommand('piChat.attachFiles', [resource])) }),
				toAction({ id: 'projects.addToWorkspace', label: localize('projects.addToWorkspace', "Add to Current Workspace"), enabled: !isWorkspaceToOpen(entry), run: () => run(() => this.workspaceEditing.addFolders([{ uri: resource }])) }),
				toAction({ id: 'projects.showInFinder', label: isMacintosh ? localize('projects.showInFinder', "Show in Finder") : isWindows ? localize('projects.showInFileExplorer', "Show in File Explorer") : localize('projects.openContainingFolder', "Open Containing Folder"), run: () => run(() => this.commands.executeCommand('revealFileInOS', resource)) }),
			],
		});
	}
}
