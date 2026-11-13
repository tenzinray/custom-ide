/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { registerMainProcessRemoteService } from '../../../../platform/ipc/electron-browser/services.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IPreviewHubService, previewHubBatteryCutoff, previewHubCaffeineCommand, previewHubChannel } from '../../../../platform/previewHub/common/previewHub.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { Extensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { PreviewHubView } from '../browser/PreviewHubView.js';

const caffeineEnabled = new RawContextKey<boolean>('previewHub.caffeineEnabled', false);

if (isMacintosh) {
	registerMainProcessRemoteService(IPreviewHubService, previewHubChannel);
	const id = 'workbench.view.previewHub';
	const icon = registerIcon('preview-hub-view-icon', Codicon.playCircle, localize('previewHub.icon', "Icon for Preview Hub."));
	const container = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry).registerViewContainer({
		id, title: localize2('previewHub.title', "Preview Hub"), icon, storageId: id, order: 6,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [id, { mergeViewWithContainerWhenSingleView: true }]),
		alwaysUseContainerInfo: true,
	}, ViewContainerLocation.Sidebar);
	Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).registerViews([{
		id: PreviewHubView.ID, name: localize2('previewHub.apps', "Preview Hub"), containerIcon: icon,
		ctorDescriptor: new SyncDescriptor(PreviewHubView), canToggleVisibility: false, canMoveView: true,
	}], container);

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: previewHubCaffeineCommand, title: localize2('previewHub.caffeinate', "Caffeinate"), icon: Codicon.coffee, f1: true,
				toggled: { condition: caffeineEnabled, title: localize('previewHub.caffeinated', "Uncaffeinate"), tooltip: localize('previewHub.caffeinatedTooltip', "Display kept awake, including on battery. Click to allow sleep.") },
				tooltip: localize('previewHub.caffeineTooltip', "Keep laptop and display awake, including on battery. Automatically turns off below {0}% on battery.", previewHubBatteryCutoff),
				menu: { id: MenuId.TitleBarAdjacentCenter, order: -1000 },
			});
		}
		async run(accessor: ServicesAccessor): Promise<void> {
			const service = accessor.get(IPreviewHubService);
			const state = await service.getSnapshot();
			await service.setCaffeine(!state.caffeine.enabled);
		}
	});

	class PreviewHubCaffeineContribution extends Disposable {
		static readonly ID = 'workbench.contrib.previewHubCaffeine';
		constructor(@IPreviewHubService hub: IPreviewHubService, @IContextKeyService contextKeys: IContextKeyService, @INotificationService notifications: INotificationService) {
			super();
			const enabled = caffeineEnabled.bindTo(contextKeys);
			let wasEnabled = false;
			this._register(hub.onDidChange(state => {
				enabled.set(state.caffeine.enabled);
				if (wasEnabled && !state.caffeine.enabled && state.caffeine.reason) {
					notifications.info(state.caffeine.reason === 'lowBattery'
						? localize('previewHub.caffeineBatteryOff', "Caffeinate switched off: battery is below {0}%.", previewHubBatteryCutoff)
						: localize('previewHub.caffeineSafetyOff', "Caffeinate switched off because the battery level could not be checked."));
				}
				wasEnabled = state.caffeine.enabled;
			}));
			void hub.getSnapshot().then(state => { if (!this._store.isDisposed) { enabled.set(state.caffeine.enabled); wasEnabled = state.caffeine.enabled; } }, error => notifications.error(error));
		}
	}
	registerWorkbenchContribution2(PreviewHubCaffeineContribution.ID, PreviewHubCaffeineContribution, WorkbenchPhase.AfterRestored);
}
