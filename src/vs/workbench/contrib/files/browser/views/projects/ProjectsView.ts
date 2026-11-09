/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../../../nls.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../../platform/theme/common/themeService.js';
import { ViewPane } from '../../../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../../../common/views.js';
import { ProjectsContainer } from './ProjectsContainer.js';
import './media/projects.css';

/** Explorer pane mechanics only. Project discovery, filtering, and opening belong to the container. */
export class ProjectsView extends ViewPane {
	static readonly ID = 'workbench.explorer.projects';
	static readonly NAME = localize2('explorer.projects', "Projects");
	private projects: ProjectsContainer | undefined;

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this._register(this.onDidChangeBodyVisibility(visible => { if (visible) { void this.projects?.refresh(); } }));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.projects = this._register(this.instantiationService.createInstance(ProjectsContainer, container));
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.projects?.layout(height, width);
	}

	override setExpanded(expanded: boolean): boolean {
		const changed = super.setExpanded(expanded);
		if (changed && expanded) { this.projects?.focus(); }
		return changed;
	}

	override focus(): void { this.projects?.focus(); }
}
