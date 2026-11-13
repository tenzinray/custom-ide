/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { PreviewHubAppId } from './previewHubApps.js';
import { PreviewHubSnapshot } from './preview-hub-types.js';

export const previewHubChannel = 'previewHub';
export const previewHubCaffeineCommand = 'previewHub.toggleCaffeine';
export const previewHubBatteryCutoff = 15;
export const previewHubPollInterval = 5000;
export const previewHubLauncherLogPath = 'logs/preview-hub-launch.log';
export const IPreviewHubService = createDecorator<IPreviewHubService>('previewHubService');

/** Main-process ownership survives renderer reloads and is shared across all app windows. */
export interface IPreviewHubService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<PreviewHubSnapshot>;
	getSnapshot(): Promise<PreviewHubSnapshot>;
	start(id: PreviewHubAppId): Promise<void>;
	stop(id: PreviewHubAppId): Promise<void>;
	setCaffeine(enabled: boolean): Promise<void>;
}
