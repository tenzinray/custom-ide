/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { PiChatSessionSummary } from '../common/pi-chat-types.js';

export const IPiChatSelectionService = createDecorator<IPiChatSelectionService>('piChatSelectionService');

export interface IPiChatSelectionService {
	readonly _serviceBrand: undefined;
	readonly onDidSelectSession: Event<PiChatSessionSummary | undefined>;
	readonly selectedSession: PiChatSessionSummary | undefined;
	selectSession(session: PiChatSessionSummary): void;
	clearSelection(): void;
}

/** One selection shared by the session list and the secondary conversation pane. */
export class PiChatSelectionService extends Disposable implements IPiChatSelectionService {
	declare readonly _serviceBrand: undefined;
	private readonly selection = this._register(new Emitter<PiChatSessionSummary | undefined>());
	readonly onDidSelectSession = this.selection.event;
	selectedSession: PiChatSessionSummary | undefined;

	clearSelection(): void {
		this.selectedSession = undefined;
		this.selection.fire(undefined);
	}

	selectSession(session: PiChatSessionSummary): void {
		this.selectedSession = session;
		this.selection.fire(session);
	}
}
