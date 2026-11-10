/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../../base/browser/dom.js';
import { IManagedHover } from '../../../../../../../base/browser/ui/hover/hover.js';
import { getDefaultHoverDelegate } from '../../../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IListRenderer } from '../../../../../../../base/browser/ui/list/list.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../../../../base/common/resources.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { ThemeIcon } from '../../../../../../../base/common/themables.js';
import { localize } from '../../../../../../../nls.js';
import { IHoverService } from '../../../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../../../platform/instantiation/common/instantiation.js';
import { WorkbenchList } from '../../../../../../../platform/list/browser/listService.js';
import { isWorkspaceToOpen } from '../../../../../../../platform/window/common/window.js';
import { getProjectResource, ProjectEntry } from '../project-entry.js';

interface ProjectRowTemplate {
	readonly icon: HTMLElement;
	readonly label: HTMLElement;
	readonly hover: IManagedHover;
}

/** Flat Explorer-style rows with distinct repository/workspace icons and no primary buttons. */
class ProjectsRenderer implements IListRenderer<ProjectEntry, ProjectRowTemplate> {
	readonly templateId = 'explorer-project';
	constructor(private readonly hoverService: IHoverService) { }
	renderTemplate(container: HTMLElement): ProjectRowTemplate {
		container.classList.add('explorer-project-row');
		return {
			icon: append(container, $('span', { 'aria-hidden': 'true' })),
			label: append(container, $('span.explorer-project-name')),
			hover: this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), container, ''),
		};
	}
	renderElement(entry: ProjectEntry, _index: number, template: ProjectRowTemplate): void {
		template.icon.className = ThemeIcon.asClassName(isWorkspaceToOpen(entry) ? Codicon.rootFolder : Codicon.repo);
		template.label.textContent = entry.name;
		template.hover.update(getProjectResource(entry).fsPath);
	}
	disposeTemplate(template: ProjectRowTemplate): void { template.hover.dispose(); }
}

/** List presentation, native workbench keyboard navigation, and empty/error messages only. */
export class ProjectsList extends Disposable {
	private readonly list: WorkbenchList<ProjectEntry>;
	private readonly message: HTMLElement;

	constructor(parent: HTMLElement, private readonly open: (entry: ProjectEntry, newWindow: boolean) => void,
		@IInstantiationService instantiationService: IInstantiationService,
		@IHoverService hoverService: IHoverService,
	) {
		super();
		const body = append(parent, $('.explorer-projects-body'));
		this.message = append(body, $('.explorer-projects-message', { role: 'status' }));
		const host = append(body, $('.explorer-projects-list'));
		const renderer = new ProjectsRenderer(hoverService);
		this.list = this._register(instantiationService.createInstance(WorkbenchList<ProjectEntry>, 'ExplorerProjects', host,
			{ getHeight: () => 22, getTemplateId: () => renderer.templateId }, [renderer], {
				identityProvider: { getId: entry => getProjectResource(entry).toString() },
				keyboardNavigationLabelProvider: { getKeyboardNavigationLabel: entry => entry.name },
				accessibilityProvider: {
					getWidgetAriaLabel: () => localize('projects.listLabel', "Projects"),
					getAriaLabel: entry => isWorkspaceToOpen(entry) ? localize('projects.workspaceLabel', "{0}, workspace", entry.name) : entry.name,
				},
				multipleSelectionSupport: false,
				openOnSingleClick: true,
			}));
		this._register(this.list.onDidOpen(event => {
			if (event.element) { this.open(event.element, event.sideBySide); }
		}));
	}

	setEntries(entries: readonly ProjectEntry[], activeFolders: readonly URI[], activeWorkspace: URI | undefined, message: string): void {
		this.list.splice(0, this.list.length, entries);
		this.list.setSelection(entries.flatMap((entry, index) => {
			const active = isWorkspaceToOpen(entry) ? isEqual(activeWorkspace, entry.workspaceUri) : activeFolders.some(folder => isEqual(folder, entry.folderUri));
			return active ? [index] : [];
		}));
		this.message.textContent = message;
		this.message.hidden = !message;
	}

	layout(height: number, width: number): void { this.list.layout(Math.max(0, height), width); }
	focusFirst(): void { if (this.list.length) { this.list.setFocus([0]); this.list.domFocus(); } }
	openFirst(): void { if (this.list.length) { this.open(this.list.element(0), false); } }
}
