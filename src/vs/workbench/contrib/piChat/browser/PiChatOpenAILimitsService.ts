/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { localize } from '../../../../nls.js';
import { PiChatOpenAILimits } from '../common/pi-chat-openai-limits-types.js';

export const IPiChatOpenAILimitsService = createDecorator<IPiChatOpenAILimitsService>('piChatOpenAILimitsService');

/** One account-wide snapshot shared by the Pi sidebar and editor tabs. */
export interface IPiChatOpenAILimitsService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	readonly limits: PiChatOpenAILimits | undefined;
	readonly refreshing: boolean;
	readonly error: string | undefined;
	load(): Promise<void>;
	refresh(): Promise<void>;
}

export class PiChatOpenAILimitsService extends Disposable implements IPiChatOpenAILimitsService {
	declare readonly _serviceBrand: undefined;
	private readonly change = this._register(new Emitter<void>());
	readonly onDidChange = this.change.event;
	private pending: Promise<void> | undefined;
	private loaded = false;
	private lastAttemptAt = 0;
	limits: PiChatOpenAILimits | undefined;
	refreshing = false;
	error: string | undefined;

	constructor(@ICommandService private readonly commands: ICommandService) { super(); }

	load(): Promise<void> {
		const now = Date.now();
		const updatedAt = this.limits?.updatedAt ?? 0;
		const resetPassed = [this.limits?.fiveHour, this.limits?.weekly].some(window => window && window.resetsAt * 1000 <= now && updatedAt < window.resetsAt * 1000);
		return (this.loaded && !resetPassed) || now - this.lastAttemptAt < 60_000 ? Promise.resolve() : this.refresh();
	}

	refresh(): Promise<void> {
		if (this.pending) { return this.pending; }
		this.refreshing = true;
		this.lastAttemptAt = Date.now();
		this.error = undefined;
		this.change.fire();
		this.pending = this.commands.executeCommand<PiChatOpenAILimits | undefined>('piChat.openAILimits').then(limits => {
			this.limits = limits;
			this.loaded = true;
		}, () => {
			this.error = localize('piChat.limitsError', "Limits unavailable. Try refreshing.");
		}).finally(() => {
			this.refreshing = false;
			this.pending = undefined;
			this.change.fire();
		});
		return this.pending;
	}
}
