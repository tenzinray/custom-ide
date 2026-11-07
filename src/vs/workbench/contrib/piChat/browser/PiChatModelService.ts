/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { joinPath } from '../../../../base/common/resources.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IPathService } from '../../../../platform/path/common/pathService.js';

/** Reads Pi's own configured default and cached model catalog without duplicating a model list. */
export class PiChatModelService {
	constructor(
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
	) { }

	async loadModels(): Promise<{ defaultModel: string | undefined; models: string[] }> {
		const agentDir = joinPath(this.pathService.userHome({ preferLocal: true }), '.pi', 'agent');
		let defaultModel: string | undefined;
		let models: string[] = [];
		try {
			const settings = JSON.parse((await this.fileService.readFile(joinPath(agentDir, 'settings.json'))).value.toString()) as { defaultProvider?: string; defaultModel?: string };
			if (settings.defaultProvider && settings.defaultModel) { defaultModel = `${settings.defaultProvider}/${settings.defaultModel}`; }
		} catch { /* Pi settings may not exist yet. */ }
		try {
			const store = JSON.parse((await this.fileService.readFile(joinPath(agentDir, 'models-store.json'))).value.toString()) as Record<string, { models?: { id?: string; provider?: string }[] }>;
			models = Object.entries(store).flatMap(([provider, data]) => (data.models ?? []).filter(model => typeof model.id === 'string').map(model => `${model.provider || provider}/${model.id}`));
		} catch { /* The cached catalog is optional. */ }
		if (defaultModel && !models.includes(defaultModel)) { models.unshift(defaultModel); }
		return { defaultModel, models };
	}
}
