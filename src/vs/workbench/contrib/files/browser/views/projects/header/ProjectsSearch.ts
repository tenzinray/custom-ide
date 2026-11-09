/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../../../base/browser/dom.js';
import { InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../../../nls.js';
import { defaultInputBoxStyles } from '../../../../../../../platform/theme/browser/defaultStyles.js';

/** Search field and its keyboard handoff to the project list. */
export class ProjectsSearch extends Disposable {
	readonly input: InputBox;

	constructor(parent: HTMLElement, focusList: () => void, openFirst: () => void) {
		super();
		const header = append(parent, $('.explorer-projects-search'));
		append(header, $('span.codicon.codicon-search', { 'aria-hidden': 'true' }));
		this.input = this._register(new InputBox(header, undefined, {
			placeholder: localize('projects.searchPlaceholder', "Search projects"),
			ariaLabel: localize('projects.searchLabel', "Search projects"),
			inputBoxStyles: defaultInputBoxStyles,
		}));
		this._register(addDisposableListener(this.input.inputElement, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'ArrowDown') { event.preventDefault(); focusList(); }
			else if (event.key === 'Enter') { event.preventDefault(); openFirst(); }
			else if (event.key === 'Escape') { event.preventDefault(); this.input.value = ''; }
		}));
	}

	focus(): void { this.input.focus(); this.input.select(); }
}
