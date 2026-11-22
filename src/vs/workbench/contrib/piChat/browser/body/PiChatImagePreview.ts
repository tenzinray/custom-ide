/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { getMediaMime } from '../../../../../base/common/mime.js';
import { FileAccess } from '../../../../../base/common/network.js';
import { basename } from '../../../../../base/common/resources.js';
import { ITextResourceEditorInput } from '../../../../../platform/editor/common/editor.js';

/** Compact previews for resolved local image links; file resolution and opening stay with the link decorator. */
export function renderPiChatImagePreview(reference: HTMLAnchorElement, input: ITextResourceEditorInput, connect: (anchor: HTMLAnchorElement, input: ITextResourceEditorInput) => void, disposables: DisposableStore): void {
	if (!getMediaMime(input.resource.path)?.startsWith('image/')) { return; }
	const document = reference.ownerDocument;
	// Put the preview after inline code, not inside its monospace/background styling.
	// Otherwise insert directly after the link, preserving its paragraph/list/table-cell location.
	const position = reference.parentElement?.tagName === 'CODE' ? reference.parentElement : reference;
	if (position.nextElementSibling?.classList.contains('pi-chat-image-preview-slot')) { return; }
	const slot = document.createElement('span');
	slot.className = 'pi-chat-image-preview-slot';
	position.after(slot);
	const key = input.resource.toString();
	const anchor = document.createElement('a');
	anchor.className = 'pi-chat-image-preview';
	anchor.dataset.imageResource = key;
	connect(anchor, input);
	const image = document.createElement('img');
	image.alt = basename(input.resource);
	image.loading = 'lazy';
	image.decoding = 'async';
	// Keep the original path usable if Chromium cannot decode this image format.
	disposables.add(addDisposableListener(image, 'error', () => {
		slot.remove();
	}));
	image.src = FileAccess.uriToBrowserUri(input.resource).toString(true);
	anchor.append(image);
	slot.append(anchor);
}
