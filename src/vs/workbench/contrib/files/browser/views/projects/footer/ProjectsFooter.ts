/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../../../nls.js';

/** Folder-picker button presentation; the container owns opening the project. */
export class ProjectsFooter extends Disposable {
	readonly element: HTMLElement;
	private readonly button: HTMLButtonElement;

	constructor(parent: HTMLElement, onSelectFolder: () => void) {
		super();
		this.element = append(parent, $('.explorer-projects-footer'));
		this.button = append(this.element, $('button.explorer-projects-select-folder', { type: 'button' }, localize('projects.selectFromFinder', "Select from Finder"))) as HTMLButtonElement;
		this._register(addDisposableListener(this.button, 'click', onSelectFolder));
	}

	setBusy(busy: boolean): void { this.button.disabled = busy; }

	override dispose(): void { this.element.remove(); super.dispose(); }
}
