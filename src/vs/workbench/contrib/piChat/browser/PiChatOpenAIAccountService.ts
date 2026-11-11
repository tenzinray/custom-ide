/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IntervalTimer } from '../../../../base/common/async.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { PiChatOpenAIAccounts } from '../common/pi-chat-openai-account-types.js';
import { IPiChatOpenAILimitsService } from './PiChatOpenAILimitsService.js';

export const IPiChatOpenAIAccountService = createDecorator<IPiChatOpenAIAccountService>('piChatOpenAIAccountService');

export interface IPiChatOpenAIAccountService {
	readonly _serviceBrand: undefined;
	readonly state: PiChatOpenAIAccounts | undefined;
	readonly onDidChange: Event<void>;
	change(id?: string): Promise<void>;
}

/** One account snapshot across panes; also observes account changes made by terminal Pi or another window. */
export class PiChatOpenAIAccountService extends Disposable implements IPiChatOpenAIAccountService {
	declare readonly _serviceBrand: undefined;
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	private readonly clock = this._register(new IntervalTimer());
	private loading = false;
	private loadRequest = 0;
	private changing = false;
	private loadError: string | undefined;
	state: PiChatOpenAIAccounts | undefined;

	constructor(
		@ICommandService private readonly commands: ICommandService,
		@IPiChatOpenAILimitsService private readonly limits: IPiChatOpenAILimitsService,
		@INotificationService private readonly notifications: INotificationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		void this.load();
		this.clock.cancelAndSet(() => { void this.load(); }, 2000);
	}

	private async load(force = false): Promise<void> {
		if ((this.loading && !force) || this.changing) { return; }
		const request = ++this.loadRequest;
		this.loading = true;
		try {
			const state = await this.commands.executeCommand<PiChatOpenAIAccounts>('piChat.openAIAccounts');
			if (!state || request !== this.loadRequest || this._store.isDisposed || this.changing) { return; }
			this.loadError = undefined;
			if (this.state && this.state.activeId !== state.activeId) { this.limits.invalidate(); }
			if (JSON.stringify(state) !== JSON.stringify(this.state)) { this.state = state; this.changed.fire(); }
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message !== this.loadError) { this.logService.warn('[pi-chat] Could not load ChatGPT accounts', error); }
			this.loadError = message;
		}
		finally { if (request === this.loadRequest) { this.loading = false; } }
	}

	async change(id?: string): Promise<void> {
		if (this.changing || this.state?.busy) { return; }
		this.changing = true;
		this.state = { accounts: [], activeId: undefined, ...this.state, busy: true };
		this.changed.fire();
		try { await this.commands.executeCommand('piChat.changeOpenAIAccount', id); }
		catch (error) { if (!isCancellationError(error)) { this.notifications.error(error instanceof Error ? error : String(error)); } }
		finally { this.changing = false; await this.load(true); }
	}
}
