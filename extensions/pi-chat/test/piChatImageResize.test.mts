/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { ResizedImage } from '../node_modules/@earendil-works/pi-coding-agent/dist/utils/image-resize.js';
import { resolvePackageDirectory } from '../../esbuild-common.mts';

const extensionDir = fileURLToPath(new URL('..', import.meta.url));
const agentDir = realpathSync(resolvePackageDirectory(extensionDir, '@earendil-works/pi-coding-agent'));
const photon = createRequire(join(agentDir, 'package.json'))('@silvia-odwyer/photon-node') as typeof import('@silvia-odwyer/photon-node');

// The installed app has no node_modules. Test only the shipped worker and WASM
// in an isolated directory so development dependencies cannot hide missing assets.
test('packaged image worker decodes PNG/JPEG and resizes without node_modules', async t => {
	const root = await mkdtemp(join(tmpdir(), 'pi-chat-images-'));
	try {
		for (const file of ['package.json', 'image-resize-worker.js', 'photon_rs_bg.wasm']) {
			await copyFile(new URL(`../dist/${file}`, import.meta.url), join(root, file));
		}
		for (const [mimeType, width, height] of [
			['image/png', 449, 700],
			['image/jpeg', 706, 1100],
			['image/png', 2400, 2100],
		] as const) {
			await t.test(`${mimeType} ${width}x${height}`, async () => {
				const image = new photon.PhotonImage(new Uint8Array(width * height * 4).fill(255), width, height);
				let inputBytes: Uint8Array;
				try { inputBytes = mimeType === 'image/png' ? image.get_bytes() : image.get_bytes_jpeg(80); }
				finally { image.free(); }
				const worker = new Worker(join(root, 'image-resize-worker.js'));
				try {
					const response = once(worker, 'message', { signal: AbortSignal.timeout(20_000) });
					worker.postMessage({ inputBytes, mimeType });
					const [message] = await response as [{ result?: ResizedImage; error?: string }];
					assert.ok(message.result, message.error ?? 'Packaged decoder returned null; check the WASM asset.');
					const result = message.result;
					const decoded = photon.PhotonImage.new_from_byteslice(Buffer.from(result.data, 'base64'));
					try {
						assert.deepStrictEqual({
							original: [result.originalWidth, result.originalHeight],
							displayed: [decoded.get_width(), decoded.get_height()],
							wasResized: result.wasResized,
						}, {
							original: [width, height],
							displayed: width > 2000 ? [2000, 1750] : [width, height],
							wasResized: width > 2000,
						});
					} finally { decoded.free(); }
				} finally { await worker.terminate(); }
			});
		}
	} finally { await rm(root, { recursive: true, force: true }); }
});
