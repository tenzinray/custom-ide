/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProcessItem } from '../../../base/common/processes.js';
import { PreviewHubAppId, PreviewHubComponentId } from './previewHubApps.js';

export type PreviewHubPhase = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface PreviewHubProcessState extends Pick<ProcessItem, 'pid'> {
	readonly componentId: PreviewHubComponentId;
	readonly urls: readonly string[];
}

export interface PreviewHubAppState {
	readonly id: PreviewHubAppId;
	readonly phase: PreviewHubPhase;
	readonly components: readonly { id: PreviewHubComponentId; running: boolean }[];
	readonly error?: string;
	readonly launcherLog: string;
	readonly watcherLog?: string;
	readonly previewUrl?: string;
	readonly processes?: readonly PreviewHubProcessState[];
}

export interface PreviewHubCaffeineState {
	readonly enabled: boolean;
	readonly batteryPercent?: number;
	readonly reason?: 'lowBattery' | 'batteryUnavailable';
}

export interface PreviewHubSnapshot {
	readonly apps: readonly PreviewHubAppState[];
	readonly caffeine: PreviewHubCaffeineState;
	readonly error?: string;
}
