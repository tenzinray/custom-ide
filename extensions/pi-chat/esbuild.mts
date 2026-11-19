/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { realpathSync } from 'node:fs';
import { copyFile, rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { resolvePackageDirectory, runBuild } from '../esbuild-common.mts';

const srcDir = path.join(import.meta.dirname, 'src');
const agentDir = realpathSync(resolvePackageDirectory(import.meta.dirname, '@earendil-works/pi-coding-agent'));
const photonDir = resolvePackageDirectory(agentDir, '@silvia-odwyer/photon-node');
await runBuild({
	entryPoints: {
		extension: path.join(srcDir, 'extension.ts'),
		'image-resize-worker': path.join(agentDir, 'dist/utils/image-resize-worker.js'),
	},
	srcDir,
	outdir: path.join(import.meta.dirname, 'dist'),
}, {
	platform: 'node',
	format: 'esm',
	bundle: true,
	minify: true,
	treeShaking: true,
	sourcemap: true,
	target: 'es2024',
	mainFields: ['module', 'main'],
	alias: { vscode: path.join(import.meta.dirname, 'vscodeRuntime.mts') },
	outExtension: { '.js': '.mjs' },
	banner: { js: `import { createRequire as __createRequire } from 'node:module'; import { fileURLToPath as __fileURLToPath } from 'node:url'; import { dirname as __pathDirname } from 'node:path'; const require = __createRequire(import.meta.url); const __dirname = __pathDirname(__fileURLToPath(import.meta.url));` },
}, process.argv, async outputDir => {
	// Pi expects this exact worker filename beside the runtime bundle. Scope
	// its ESM format to dist without changing the extension's CJS bootstrap.
	// Photon also reads this WASM asset with fs, which esbuild cannot discover.
	await Promise.all([
		rename(path.join(outputDir, 'image-resize-worker.mjs'), path.join(outputDir, 'image-resize-worker.js')),
		writeFile(path.join(outputDir, 'package.json'), '{"type":"module"}\n'),
		copyFile(path.join(photonDir, 'photon_rs_bg.wasm'), path.join(outputDir, 'photon_rs_bg.wasm')),
	]);
	console.log('[pi-chat] Runtime bundle and image decoder built');
});
