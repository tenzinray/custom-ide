/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
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
import { PiChatConversationContainer } from './PiChatConversationContainer.js';
import { IPiChatSelectionService, PiChatSessionOpenOptions } from './PiChatSelectionService.js';

/** Secondary sidebar shell; the container owns conversation tabs, splits, and new-chat coordination. */
export class PiChatConversationView extends ViewPane {
	static readonly ID = 'workbench.view.piChatConversation';
	private conversation: PiChatConversationContainer | undefined;

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
		@IPiChatSelectionService private readonly selection: IPiChatSelectionService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, piInstantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.conversation = this._register(this.piInstantiationService.createInstance(PiChatConversationContainer, container));
		this._register(this.conversation.onDidChangeTitle(() => this.updateConversationTitle()));
		this.updateConversationTitle();
	}

	override getTitleControl(): HTMLElement | undefined {
		return this.conversation?.titleControl;
	}

	override getTitleHeight(): number | undefined {
		return this.selection.groups.length > 1 ? 0 : undefined;
	}

	async newChat(folder?: URI, options?: PiChatSessionOpenOptions): Promise<void> {
		await this.conversation?.newChat(folder, options);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.conversation?.layout(width, height);
	}

	insertFiles(resources: readonly URI[]): boolean {
		return this.conversation?.insertFiles(resources) ?? false;
	}

	private updateConversationTitle(): void {
		this.updateTitle(this.singleViewPaneContainerTitle);
		const container = this.viewDescriptorService.getViewContainerByViewId(PiChatConversationView.ID);
		if (container) {
			this.viewDescriptorService.getViewContainerModel(container).setTitleOverride(this.selection.selectedSession?.repoName);
		}
	}
}
