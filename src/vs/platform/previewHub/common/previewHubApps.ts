/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';

/** Local commands and existing logs; repository roots come from getProjectsDirectory. */
export const previewHubApps = [
	{
		id: 'brain-wave', name: 'Brain Wave', folder: 'brain-wave', command: ['npm', 'run', 'dev'],
		components: [{ id: 'frontend', name: localize('previewHub.vite', "Frontend / Vite API"), match: '(?:node_modules/vite/bin/vite\\.js|(?:\\./)?scripts/viteStartLogged\\.mjs)' }],
		logs: [{ name: localize('previewHub.frontendLog', "Frontend Log"), path: 'logs/frontend/brain-wave.log' }],
	},
	{
		id: 'lucent', name: 'Lucent', folder: 'lucent', command: ['npm', 'run', 'expo-start'],
		components: [{ id: 'frontend', name: localize('previewHub.expo', "Frontend / Expo"), match: '(?:node_modules/(?:\\.bin/expo|expo/bin/cli)|(?:\\./)?logs/expo-start-logged\\.js)' }],
		logs: [{ name: localize('previewHub.expoLog', "Expo Log"), path: 'logs/frontend/expo-logs_lucent.log' }],
	},
	{
		id: 'pide', name: 'Pide Dev', folder: 'custom-ide', command: ['bash', 'scripts/watch-and-launch.sh', '--preview-hub'],
		watchCommand: ['pnpm', 'run', 'watch'],
		components: [
			{ id: 'watcher', name: localize('previewHub.watcher', "Watcher"), match: 'pnpm run watch' },
			{ id: 'app', name: localize('previewHub.devApp', "Dev App"), match: '\\.build/electron/Pide\\.app/Contents/MacOS/Pide' },
		],
		logs: [
			{ name: localize('previewHub.watcherLog', "Watcher Log"), path: 'logs/watch.log' },
			{ name: localize('previewHub.prelaunchLog', "Prelaunch Log"), path: 'logs/prelaunch.log' },
		],
	},
] as const;

export type PreviewHubAppId = typeof previewHubApps[number]['id'];
export type PreviewHubComponentId = typeof previewHubApps[number]['components'][number]['id'];
