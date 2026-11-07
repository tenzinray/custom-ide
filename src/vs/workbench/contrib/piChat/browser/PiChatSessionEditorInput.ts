/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { PiChatSessionSummary } from '../common/pi-chat-types.js';

export class PiChatSessionEditorInput extends EditorInput {
	static readonly ID = 'workbench.editors.piChatSession';

	static resourceForSession(id: string): URI { return URI.from({ scheme: 'pi-chat', path: `/${id}` }); }

	constructor(readonly session: PiChatSessionSummary) {
		super();
	}

	override get typeId(): string { return PiChatSessionEditorInput.ID; }
	override get editorId(): string { return 'workbench.editor.piChatSession'; }
	override get resource(): URI { return PiChatSessionEditorInput.resourceForSession(this.session.id); }
	override getName(): string { return this.session.repoName; }
	override getDescription(): string { return localize('piChat.sessionDescription', "Pi conversation"); }
	override matches(other: EditorInput): boolean {
		return other instanceof PiChatSessionEditorInput && other.session.id === this.session.id;
	}
}
