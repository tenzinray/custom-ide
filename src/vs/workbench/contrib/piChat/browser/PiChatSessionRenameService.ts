/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import Severity from '../../../../base/common/severity.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { InlineEditInputBox } from '../../../browser/parts/views/inlineEditInputBox.js';
import { isPiChatSessionTab } from '../common/pi-chat-tab-types.js';
import { getPiChatSessionLabel, PiChatSessionSummary } from '../common/pi-chat-types.js';
import { PiChatInputCacheService } from './PiChatInputCacheService.js';
import { IPiChatSelectionService } from './PiChatSelectionService.js';

/** Shared inline rename lifecycle and native Pi name persistence for lists and tab strips. */
export class PiChatSessionRenameService extends Disposable {
	private readonly editing = this._register(new MutableDisposable<DisposableStore>());
	private readonly inputCache: PiChatInputCacheService;
	get isEditing(): boolean { return !!this.editing.value; }

	constructor(
		@IInstantiationService private readonly instantiation: IInstantiationService,
		@ICommandService private readonly commands: ICommandService,
		@IPiChatSelectionService private readonly selection: IPiChatSelectionService,
		@INotificationService private readonly notifications: INotificationService,
	) {
		super();
		this.inputCache = instantiation.createInstance(PiChatInputCacheService);
	}

	begin(session: PiChatSessionSummary, label: HTMLElement, onFinish?: () => void): void {
		if (this.isEditing) { return; }
		const original = label.textContent;
		const value = getPiChatSessionLabel(session);
		const disposables = new DisposableStore();
		this.editing.value = disposables;
		label.textContent = '';
		label.classList.add('pi-chat-session-renaming');
		disposables.add(toDisposable(() => {
			label.classList.remove('pi-chat-session-renaming');
			label.textContent = original;
		}));
		// Editing a title must not select, drag, or close its containing row/tab.
		for (const type of ['click', 'dblclick', 'keydown', 'dragstart']) {
			disposables.add(addDisposableListener(label, type, event => event.stopPropagation()));
		}
		disposables.add(this.instantiation.createInstance(InlineEditInputBox, label, {
			validationMessage: name => name.trim() ? null : { content: localize('piChat.emptySessionName', "Enter a chat name."), severity: Severity.Error },
			onFinish: async (name, success) => {
				this.editing.clear();
				onFinish?.();
				if (success && name.trim() !== value) { await this.save(session, name.trim()); }
			},
		}, { value, ariaLabel: localize('piChat.renameSessionInput', "Type chat name. Press Enter to confirm or Escape to cancel.") }));
	}

	private async save(session: PiChatSessionSummary, name: string): Promise<void> {
		try {
			await this.commands.executeCommand('piChat.renameSession', session.id, session.sessionFile.fsPath, session.repoPath, name);
			const latest = this.selection.groups.flatMap(group => group.tabs).filter(isPiChatSessionTab).find(tab => tab.id === session.id);
			const updated = { ...(latest ?? session), sessionName: name };
			if (updated.isDraft) { this.inputCache.setDraftSession(updated); }
			this.selection.updateSession(updated);
		} catch (error) { this.notifications.error(error); }
	}
}
