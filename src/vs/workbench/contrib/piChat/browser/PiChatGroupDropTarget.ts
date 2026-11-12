/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, DragAndDropObserver, getWindow } from '../../../../base/browser/dom.js';
import { Direction } from '../../../../base/browser/ui/grid/grid.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { containsDragType } from '../../../../platform/dnd/browser/dnd.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { fillEditorsDragData } from '../../../browser/dnd.js';
import { PiChatSessionSummary } from '../common/pi-chat-types.js';
import { PiChatSessionOpenOptions } from './PiChatSelectionService.js';
import { PiChatSessionEditorInput } from './PiChatSessionEditorInput.js';

const sessionTransfer = 'application/vnd.code.pi-chat-session';
const groupTransfer = 'application/vnd.code.pi-chat-group';

export function isPiChatDragEvent(event: DragEvent): boolean {
	return containsDragType(event, sessionTransfer);
}

/** Keep standard editor drag data so dragging a chat into the Editor Area still works. */
export function fillPiChatDragData(instantiation: IInstantiationService, session: PiChatSessionSummary, event: DragEvent, groupId?: number): void {
	instantiation.invokeFunction(accessor => fillEditorsDragData(accessor, [PiChatSessionEditorInput.resourceForSession(session.id)], event));
	event.dataTransfer?.setData(sessionTransfer, session.id);
	if (groupId !== undefined) { event.dataTransfer?.setData(groupTransfer, String(groupId)); }
}

/** Chat-only drop targets; file attachment drops continue through to the conversation. */
export class PiChatGroupDropTarget extends Disposable {
	constructor(element: HTMLElement, onDrop: (sessionId: string, sourceGroupId: number | undefined, direction: PiChatSessionOpenOptions['direction']) => void, mergeOnly = false) {
		super();
		const clear = () => { delete element.dataset.chatDrop; };
		const directionAt = (event: DragEvent): PiChatSessionOpenOptions['direction'] => {
			if (mergeOnly) { return undefined; }
			const rect = element.getBoundingClientRect();
			const x = (event.clientX - rect.left) / rect.width;
			return x < 0.25 ? Direction.Left : x > 0.75 ? Direction.Right : undefined;
		};
		const over = (event: DragEvent) => {
			if (!isPiChatDragEvent(event)) { return; }
			event.preventDefault();
			event.stopPropagation();
			if (event.dataTransfer) { event.dataTransfer.dropEffect = 'move'; }
			const direction = directionAt(event);
			element.dataset.chatDrop = direction === undefined ? 'center' : direction === Direction.Left ? 'left' : 'right';
		};
		this._register(new DragAndDropObserver(element, {
			onDragEnter: over, onDragOver: over, onDragLeave: clear, onDragEnd: clear,
			onDrop: event => {
				clear();
				if (!isPiChatDragEvent(event)) { return; }
				event.preventDefault();
				event.stopPropagation();
				const sessionId = event.dataTransfer?.getData(sessionTransfer);
				const source = event.dataTransfer?.getData(groupTransfer);
				if (sessionId) { onDrop(sessionId, source && /^\d+$/.test(source) ? Number(source) : undefined, directionAt(event)); }
			},
		}));
		// Capture before the current target paints its preview: only the target under the
		// pointer may stay highlighted, even if native dragleave misses its previous target.
		// Capture drop too: moving a tab can remove its source before dragend bubbles.
		const targetWindow = getWindow(element);
		for (const event of ['dragenter', 'dragover', 'drop', 'dragend', 'pointerup']) {
			this._register(addDisposableListener(targetWindow.document, event, clear, true));
		}
		this._register(addDisposableListener(targetWindow.document, 'keydown', event => { if (event.key === 'Escape') { clear(); } }, true));
		this._register(addDisposableListener(targetWindow, 'blur', clear));
		this._register(toDisposable(clear));
	}
}
