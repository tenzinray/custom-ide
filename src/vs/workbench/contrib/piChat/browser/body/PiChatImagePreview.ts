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
export function renderPiChatImagePreview(message: HTMLElement, input: ITextResourceEditorInput, connect: (anchor: HTMLAnchorElement, input: ITextResourceEditorInput) => void, disposables: DisposableStore): void {
	if (!getMediaMime(input.resource.path)?.startsWith('image/')) { return; }
	const document = message.ownerDocument;
	let gallery = Array.from(message.children).find(child => child.classList.contains('pi-chat-image-previews')) as HTMLElement | undefined;
	if (!gallery) {
		gallery = document.createElement('div');
		gallery.className = 'pi-chat-image-previews';
		message.append(gallery);
	}
	const key = input.resource.toString();
	if (Array.from(gallery.children).some(child => (child as HTMLElement).dataset.imageResource === key)) { return; }
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
		anchor.remove();
		if (!gallery!.children.length) { gallery!.remove(); }
	}));
	image.src = FileAccess.uriToBrowserUri(input.resource).toString(true);
	anchor.append(image);
	gallery.append(anchor);
}
