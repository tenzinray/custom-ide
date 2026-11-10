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
import { ProjectsDragAndDrop } from '../projectDragAndDrop.js';

const selectFolderRow = 'select-folder';
const selectFolderLabel = localize('projects.selectFromFinder', "Select from Finder");
type ProjectsListEntry = ProjectEntry | typeof selectFolderRow;

interface ProjectRowTemplate {
	readonly container: HTMLElement;
	readonly icon: HTMLElement;
	readonly label: HTMLElement;
	readonly hover: IManagedHover;
}

/** Flat project rows plus the Finder action, all owned by the same native list. */
class ProjectsRenderer implements IListRenderer<ProjectsListEntry, ProjectRowTemplate> {
	readonly templateId = 'explorer-project';
	constructor(private readonly hoverService: IHoverService) { }
	renderTemplate(container: HTMLElement): ProjectRowTemplate {
		container.classList.add('explorer-project-row');
		return {
			container,
			icon: append(container, $('span', { 'aria-hidden': 'true' })),
			label: append(container, $('span.explorer-project-name')),
			hover: this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), container, ''),
		};
	}
	renderElement(entry: ProjectsListEntry, _index: number, template: ProjectRowTemplate): void {
		const isFolderAction = entry === selectFolderRow;
		template.container.classList.toggle('explorer-project-select-folder', isFolderAction);
		template.icon.className = ThemeIcon.asClassName(isFolderAction ? Codicon.add : isWorkspaceToOpen(entry) ? Codicon.rootFolder : Codicon.repo);
		template.label.textContent = isFolderAction ? selectFolderLabel : entry.name;
		template.hover.update(isFolderAction ? selectFolderLabel : getProjectResource(entry).fsPath);
	}
	disposeTemplate(template: ProjectRowTemplate): void { template.hover.dispose(); }
}

/** List presentation, native workbench keyboard navigation, and empty/error messages only. */
export class ProjectsList extends Disposable {
	private readonly list: WorkbenchList<ProjectsListEntry>;
	private readonly element: HTMLElement;
	private readonly message: HTMLElement;
	private height = 0;
	private width = 0;

	constructor(parent: HTMLElement, private readonly open: (entry: ProjectEntry, newWindow: boolean) => void, private readonly selectFolder: () => void,
		@IInstantiationService instantiationService: IInstantiationService,
		@IHoverService hoverService: IHoverService,
	) {
		super();
		this.element = append(parent, $('.explorer-projects-body'));
		this.message = append(this.element, $('.explorer-projects-message', { role: 'status' }));
		const host = append(this.element, $('.explorer-projects-list'));
		const renderer = new ProjectsRenderer(hoverService);
		this.list = this._register(instantiationService.createInstance(WorkbenchList<ProjectsListEntry>, 'ExplorerProjects', host,
			{ getHeight: () => 22, getTemplateId: () => renderer.templateId }, [renderer], {
				identityProvider: { getId: entry => entry === selectFolderRow ? selectFolderRow : getProjectResource(entry).toString() },
				keyboardNavigationLabelProvider: { getKeyboardNavigationLabel: entry => entry === selectFolderRow ? selectFolderLabel : entry.name },
				accessibilityProvider: {
					getWidgetAriaLabel: () => localize('projects.listLabel', "Projects"),
					getAriaLabel: entry => entry === selectFolderRow ? selectFolderLabel : isWorkspaceToOpen(entry) ? localize('projects.workspaceLabel', "{0}, workspace", entry.name) : entry.name,
				},
				dnd: new ProjectsDragAndDrop(),
				multipleSelectionSupport: false,
				openOnSingleClick: true,
			}));
		this._register(this.list.onDidOpen(event => {
			if (event.element === selectFolderRow) { this.selectFolder(); }
			else if (event.element) { this.open(event.element, event.sideBySide); }
		}));
	}

	setEntries(entries: readonly ProjectEntry[], activeFolders: readonly URI[], activeWorkspace: URI | undefined, message: string): void {
		this.list.splice(0, this.list.length, [...entries, selectFolderRow]);
		this.list.setSelection(entries.flatMap((entry, index) => {
			const active = isWorkspaceToOpen(entry) ? isEqual(activeWorkspace, entry.workspaceUri) : activeFolders.some(folder => isEqual(folder, entry.folderUri));
			return active ? [index] : [];
		}));
		this.message.textContent = message;
		this.message.hidden = !message;
		this.layout(this.height, this.width);
	}

	setBusy(busy: boolean): void { this.element.setAttribute('aria-busy', String(busy)); }

	layout(height: number, width: number): void {
		this.height = height;
		this.width = width;
		this.list.layout(Math.max(0, height - this.message.offsetHeight), width);
	}
	focusFirst(): void { if (this.list.length) { this.list.setFocus([0]); this.list.domFocus(); } }
	openFirst(): void {
		if (!this.list.length) { return; }
		const entry = this.list.element(0);
		if (entry === selectFolderRow) { this.selectFolder(); }
		else { this.open(entry, false); }
	}
}
