/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { ActionBar } from '../../../../../base/browser/ui/actionbar/actionbar.js';
import { Action } from '../../../../../base/common/actions.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ExplorerItem } from '../../common/explorerModel.js';

/** Presentation-only actions for a workspace project's Explorer header. */
export class ExplorerProjectActions extends Disposable {
	private readonly container: HTMLElement;

	constructor(parent: HTMLElement, project: ExplorerItem, collapse: (project: ExplorerItem) => void, @ICommandService commands: ICommandService) {
		super();
		this.container = DOM.append(parent, DOM.$('.explorer-project-actions'));
		// Toolbar interaction must not toggle or select the containing tree row.
		for (const event of [DOM.EventType.MOUSE_DOWN, DOM.EventType.CLICK, DOM.EventType.DBLCLICK]) {
			this._register(DOM.addDisposableListener(this.container, event, e => e.stopPropagation()));
		}
		const bar = this._register(new ActionBar(this.container, { ariaLabel: localize('projectActions', "Project Actions") }));
		bar.push([
			this._register(new Action('explorer.newProjectChat', localize('newProjectChat', "New Chat in Project"), ThemeIcon.asClassName(Codicon.commentDiscussion), project.resource.scheme === 'file', () => commands.executeCommand('piChat.newChat', project.resource))),
			this._register(new Action('explorer.collapseProjectFolders', localize('collapseProjectFolders', "Collapse All Folders in Project"), ThemeIcon.asClassName(Codicon.collapseAll), true, () => collapse(project)))
		], { icon: true, label: false });
	}

	override dispose(): void {
		super.dispose();
		this.container.remove();
	}
}
