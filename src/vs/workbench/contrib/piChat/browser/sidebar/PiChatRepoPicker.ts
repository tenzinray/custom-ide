/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { PiChatRepoPickerContainer } from '../PiChatRepoPickerContainer.js';

/** Popup shell only; shares new-chat data flow and rows with the inline empty state. */
export class PiChatRepoPicker extends Disposable {
	private readonly overlay: HTMLElement;

	constructor(anchor: HTMLElement, onClose: () => void, @IInstantiationService instantiationService: IInstantiationService) {
		super();
		// Attach inside the workbench so theme tokens and its font inherit into the dialog.
		this.overlay = append(anchor.closest('.monaco-workbench') ?? anchor, $('.pi-chat-repo-overlay'));
		this._register(addDisposableListener(this.overlay, 'click', event => { if (event.target === this.overlay) { onClose(); } }));
		const dialog = append(this.overlay, $('.pi-chat-repo-picker', { role: 'dialog', 'aria-modal': 'true', 'aria-label': localize('piChat.newChat', "New chat") }));
		const heading = append(dialog, $('.pi-chat-repo-heading'));
		const info = append(heading, $('div'));
		append(info, $('h2', {}, localize('piChat.newChatHeading', "New chat")));
		append(info, $('p', {}, localize('piChat.chooseRepo', "Choose a repo.")));
		const close = append(heading, $('button.codicon.codicon-close', { type: 'button', 'aria-label': localize('piChat.closeRepoPicker', "Close") }));
		this._register(addDisposableListener(close, 'click', onClose));
		this._register(addDisposableListener(this.overlay, 'keydown', event => { if (event.key === 'Escape') { onClose(); } }));
		this._register(instantiationService.createInstance(PiChatRepoPickerContainer, dialog, onClose)).focus();
	}

	override dispose(): void { this.overlay.remove(); super.dispose(); }
}
