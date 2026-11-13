/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { PreviewHubContainer } from './PreviewHubContainer.js';
import './media/previewHub.css';

/** Activity-bar view shell; the container owns all Preview Hub behavior. */
export class PreviewHubView extends ViewPane {
	static readonly ID = 'workbench.view.previewHub.apps';

	constructor(options: IViewletViewOptions,
		@IKeybindingService keybindings: IKeybindingService,
		@IContextMenuService contextMenus: IContextMenuService,
		@IConfigurationService configuration: IConfigurationService,
		@IContextKeyService contextKeys: IContextKeyService,
		@IViewDescriptorService descriptors: IViewDescriptorService,
		@IInstantiationService private readonly instantiation: IInstantiationService,
		@IOpenerService opener: IOpenerService,
		@IThemeService theme: IThemeService,
		@IHoverService hover: IHoverService,
	) { super(options, keybindings, contextMenus, configuration, contextKeys, descriptors, instantiation, opener, theme, hover); }

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this._register(this.instantiation.createInstance(PreviewHubContainer, container));
	}
}
