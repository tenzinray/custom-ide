/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Direction } from '../../../../base/browser/ui/grid/grid.js';
import { URI } from '../../../../base/common/uri.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { WorkbenchStateContext } from '../../../common/contextkeys.js';
import { VIEW_ID as explorerViewId } from '../../files/common/files.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../nls.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions } from '../../../common/editor.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { PiChatConversationView } from './PiChatConversationView.js';
import { PiChatSessionEditor } from './PiChatSessionEditor.js';
import { PiChatSessionEditorInput } from './PiChatSessionEditorInput.js';
import { PiChatSessionsView } from './PiChatSessionsView.js';
import { PiChatSessionListService } from './PiChatSessionListService.js';
import { IPiChatSelectionService, PiChatSelectionService } from './PiChatSelectionService.js';
import { IPiChatOpenAIAccountService, PiChatOpenAIAccountService } from './PiChatOpenAIAccountService.js';
import { IPiChatOpenAILimitsService, PiChatOpenAILimitsService } from './PiChatOpenAILimitsService.js';

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'piChat.newChat', title: localize2('piChat.newChat', "New Pi Chat"), f1: true });
	}

	async run(accessor: ServicesAccessor, folder?: URI, split = false): Promise<void> {
		const notifications = accessor.get(INotificationService);
		try {
			const view = await accessor.get(IViewsService).openView<PiChatConversationView>(PiChatConversationView.ID, true);
			await view?.newChat(folder, split ? { direction: Direction.Right } : {});
		} catch (error) { notifications.error(error); }
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'piChat.newWorkspaceFolderChat', title: localize2('piChat.newProjectChat', "New Chat in Project"), icon: Codicon.commentDiscussion,
			menu: { id: MenuId.ViewTitle, group: 'navigation', order: 35, when: ContextKeyExpr.and(ContextKeyExpr.equals('view', explorerViewId), WorkbenchStateContext.isEqualTo('folder')) },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const folder = accessor.get(IWorkspaceContextService).getWorkspace().folders[0]?.uri;
		if (folder?.scheme === 'file') { await accessor.get(ICommandService).executeCommand('piChat.newChat', folder); }
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'piChat.attachFiles', title: localize2('piChat.attachFiles', "Add File to Pi Chat") });
	}

	async run(accessor: ServicesAccessor, resources: URI[]): Promise<void> {
		const editor = accessor.get(IEditorService).activeEditorPane;
		const views = accessor.get(IViewsService);
		const notifications = accessor.get(INotificationService);
		if (editor instanceof PiChatSessionEditor && editor.insertFiles(resources)) { return; }
		const view = await views.openView<PiChatConversationView>(PiChatConversationView.ID, true);
		if (!view?.insertFiles(resources)) {
			notifications.info(localize('piChat.selectBeforeAttach', "Select a Pi conversation or start a new chat before adding files."));
		}
	}
});

registerSingleton(IPiChatSelectionService, PiChatSelectionService, InstantiationType.Delayed);
registerSingleton(IPiChatOpenAILimitsService, PiChatOpenAILimitsService, InstantiationType.Delayed);
registerSingleton(IPiChatOpenAIAccountService, PiChatOpenAIAccountService, InstantiationType.Delayed);

const containerId = 'workbench.view.piChat';
const icon = registerIcon('pi-chat-view-icon', Codicon.commentDiscussion, localize('piChat.icon', "Icon for Pi conversations."));
const container = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: containerId,
	title: localize2('piChat.title', "Chat"),
	icon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [containerId, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: containerId,
	order: 5,
	alwaysUseContainerInfo: true,
}, ViewContainerLocation.Sidebar);

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: PiChatSessionsView.ID,
	name: localize2('piChat.conversations', "Conversations"),
	containerIcon: icon,
	ctorDescriptor: new SyncDescriptor(PiChatSessionsView),
	canToggleVisibility: false,
	canMoveView: false,
}], container);

const conversationContainerId = 'workbench.view.piChatConversationContainer';
const conversationContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: conversationContainerId,
	title: localize2('piChat.secondaryTitle', "Pi Conversation"),
	icon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [conversationContainerId, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: conversationContainerId,
	order: 0,
}, ViewContainerLocation.AuxiliaryBar, { isDefault: true });

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: PiChatConversationView.ID,
	name: localize2('piChat.conversation', "Pi Conversation"),
	containerIcon: icon,
	ctorDescriptor: new SyncDescriptor(PiChatConversationView),
	canToggleVisibility: false,
	canMoveView: false,
}], conversationContainer);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(PiChatSessionEditor, PiChatSessionEditor.ID, localize('piChat.editor', "Pi Conversation")),
	[new SyncDescriptor(PiChatSessionEditorInput)]
);

class PiChatEditorResolver implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.piChatEditorResolver';
	constructor(@IEditorResolverService editorResolver: IEditorResolverService, @IInstantiationService instantiationService: IInstantiationService, @IPiChatSelectionService selection: IPiChatSelectionService) {
		const sessions = instantiationService.createInstance(PiChatSessionListService);
		editorResolver.registerEditor('pi-chat:**/**', {
			id: PiChatSessionEditor.ID,
			label: localize('piChat.openWith', "Pi Conversation"),
			priority: RegisteredEditorPriority.exclusive,
		}, { singlePerResource: true }, {
			createEditorInput: async ({ resource }) => {
				const id = resource.path.slice(1);
				const session = selection.groups.flatMap(group => group.sessions).find(session => session.id === id) ?? await sessions.findSession(id);
				if (!session) { throw new Error(`Pi session not found: ${resource.path}`); }
				return { editor: new PiChatSessionEditorInput(session) };
			},
		});
	}
}
registerWorkbenchContribution2(PiChatEditorResolver.ID, PiChatEditorResolver, WorkbenchPhase.BlockStartup);
