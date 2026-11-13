/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';
import { runBuild } from '../esbuild-common.mts';

const srcDir = path.join(import.meta.dirname, 'src');
await runBuild({
	entryPoints: { extension: path.join(srcDir, 'extension.ts') },
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
}, process.argv, () => console.log('[pi-chat] Runtime bundle built'));
