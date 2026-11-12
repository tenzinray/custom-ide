/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { PiChatCreatedSession } from '../common/pi-chat-run-types.js';
import { PiChatSessionSummary } from '../common/pi-chat-types.js';
import { PiChatInputCacheService } from './PiChatInputCacheService.js';

/** Creates and caches drafts for both repository pickers and Explorer project actions. */
export class PiChatSessionCreationService {
	private readonly inputCache: PiChatInputCacheService;
	constructor(@ICommandService private readonly commands: ICommandService, @IInstantiationService instantiationService: IInstantiationService) {
		this.inputCache = instantiationService.createInstance(PiChatInputCacheService);
	}

	async createDraft(folder: URI): Promise<PiChatSessionSummary | undefined> {
		const created = await this.commands.executeCommand<PiChatCreatedSession>('piChat.createSession', folder.fsPath);
		if (!created) { return undefined; }
		const draft: PiChatSessionSummary = { id: created.id, repoName: basename(folder), repoPath: folder.fsPath, lastMessageAt: new Date().toISOString(), sessionFile: URI.file(created.sessionFile), isDraft: true };
		this.inputCache.setDraftSession(draft);
		return draft;
	}
}
