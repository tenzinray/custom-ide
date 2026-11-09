/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../../base/browser/dom.js';
import { IManagedHover } from '../../../../../../../base/browser/ui/hover/hover.js';
import { getDefaultHoverDelegate } from '../../../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IListRenderer } from '../../../../../../../base/browser/ui/list/list.js';
import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../../../../base/common/resources.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { localize } from '../../../../../../../nls.js';
import { IHoverService } from '../../../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../../../platform/instantiation/common/instantiation.js';
import { WorkbenchList } from '../../../../../../../platform/list/browser/listService.js';
import { GitRepository } from '../../../../../workspace/browser/gitRepositories.js';

interface ProjectRowTemplate {
	readonly label: HTMLElement;
	readonly hover: IManagedHover;
}

/** Flat Explorer-style repo rows: repository icons, no disclosure arrows or primary buttons. */
class ProjectsRenderer implements IListRenderer<GitRepository, ProjectRowTemplate> {
	readonly templateId = 'explorer-project';
	constructor(private readonly hoverService: IHoverService) { }
	renderTemplate(container: HTMLElement): ProjectRowTemplate {
		container.classList.add('explorer-project-row');
		append(container, $('span.codicon.codicon-repo', { 'aria-hidden': 'true' }));
		return {
			label: append(container, $('span.explorer-project-name')),
			hover: this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), container, ''),
		};
	}
	renderElement(repo: GitRepository, _index: number, template: ProjectRowTemplate): void {
		template.label.textContent = repo.name;
		template.hover.update(repo.folderUri.fsPath);
	}
	disposeTemplate(template: ProjectRowTemplate): void { template.hover.dispose(); }
}

/** List presentation, native workbench keyboard navigation, and empty/error messages only. */
export class ProjectsList extends Disposable {
	private readonly list: WorkbenchList<GitRepository>;
	private readonly message: HTMLElement;

	constructor(parent: HTMLElement, private readonly open: (repo: GitRepository, newWindow: boolean) => void,
		@IInstantiationService instantiationService: IInstantiationService,
		@IHoverService hoverService: IHoverService,
	) {
		super();
		const body = append(parent, $('.explorer-projects-body'));
		this.message = append(body, $('.explorer-projects-message', { role: 'status' }));
		const host = append(body, $('.explorer-projects-list'));
		const renderer = new ProjectsRenderer(hoverService);
		this.list = this._register(instantiationService.createInstance(WorkbenchList<GitRepository>, 'ExplorerProjects', host,
			{ getHeight: () => 22, getTemplateId: () => renderer.templateId }, [renderer], {
				identityProvider: { getId: repo => repo.folderUri.toString() },
				keyboardNavigationLabelProvider: { getKeyboardNavigationLabel: repo => repo.name },
				accessibilityProvider: { getWidgetAriaLabel: () => localize('projects.listLabel', "Projects"), getAriaLabel: repo => repo.name },
				multipleSelectionSupport: false,
				openOnSingleClick: true,
			}));
		this._register(this.list.onDidOpen(event => {
			if (event.element) { this.open(event.element, event.sideBySide); }
		}));
	}

	setEntries(repos: readonly GitRepository[], activeFolders: readonly URI[], message: string): void {
		this.list.splice(0, this.list.length, repos);
		this.list.setSelection(repos.flatMap((repo, index) => activeFolders.some(folder => isEqual(folder, repo.folderUri)) ? [index] : []));
		this.message.textContent = message;
		this.message.hidden = !message;
	}

	layout(height: number, width: number): void { this.list.layout(Math.max(0, height), width); }
	focusFirst(): void { if (this.list.length) { this.list.setFocus([0]); this.list.domFocus(); } }
	openFirst(): void { if (this.list.length) { this.open(this.list.element(0), false); } }
}
