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
import { IMarkdownRendererService } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { PiChatConversationPane } from './PiChatConversationPane.js';
import { IPiChatSelectionService } from './PiChatSelectionService.js';

/** Secondary sidebar conversation; selecting a saved session changes only this view. */
export class PiChatConversationView extends ViewPane {
	static readonly ID = 'workbench.view.piChatConversation';
	private conversation: PiChatConversationPane | undefined;

	override get singleViewPaneContainerTitle(): string {
		return this.selection?.selectedSession?.repoName ?? 'Pi Conversation';
	}

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService private readonly piInstantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IMarkdownRendererService private readonly markdown: IMarkdownRendererService,
		@IPiChatSelectionService private readonly selection: IPiChatSelectionService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, piInstantiationService, openerService, themeService, hoverService);
		this._register(selection.onDidSelectSession(session => {
			this.updateTitle(session.repoName);
			this.updateCompositeTabLabel();
			void this.conversation?.show(session);
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.conversation = this._register(new PiChatConversationPane(container, this.piInstantiationService, this.markdown));
		if (this.selection.selectedSession) {
			this.updateTitle(this.selection.selectedSession.repoName);
			this.updateCompositeTabLabel();
			void this.conversation.show(this.selection.selectedSession);
		}
	}

	private updateCompositeTabLabel(): void {
		const container = this.viewDescriptorService.getViewContainerByViewId(PiChatConversationView.ID);
		if (container) {
			this.viewDescriptorService.getViewContainerModel(container).setTitleOverride(this.selection.selectedSession?.repoName);
		}
	}
}
