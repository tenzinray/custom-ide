/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { PiChatConversationPane } from './PiChatConversationPane.js';
import { PiChatSessionEditorInput } from './PiChatSessionEditorInput.js';
import { IPiChatSelectionService } from './PiChatSelectionService.js';

/** Editor tab uses the same conversation as the secondary sidebar. */
export class PiChatSessionEditor extends EditorPane {
	static readonly ID = 'workbench.editor.piChatSession';
	private conversation: PiChatConversationPane | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IPiChatSelectionService selection: IPiChatSelectionService,
	) {
		super(PiChatSessionEditor.ID, group, telemetryService, themeService, storageService);
		this._register(selection.onDidSelectSession(session => {
			if (this.input instanceof PiChatSessionEditorInput && this.input.session.id === session.id) { this.input.updateSession(session); }
		}));
	}

	protected override createEditor(parent: HTMLElement): void {
		this.conversation = this._register(this.instantiationService.createInstance(PiChatConversationPane, parent));
	}

	insertFiles(resources: readonly URI[]): boolean {
		return this.conversation?.insertFiles(resources) ?? false;
	}

	override layout(_dimension: Dimension): void { }

	override async setInput(input: PiChatSessionEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!token.isCancellationRequested) { await this.conversation?.show(input.session); }
	}
}
