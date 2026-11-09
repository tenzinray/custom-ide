/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getNodeGypHeadersDirectory } from '../npm/nodeGypHeaders.ts';
import { getElectronVersion } from '../lib/electronVersion.ts';

const root = path.resolve(import.meta.dirname, '../..');
export const appleSpeechUsageDescription = 'Code - OSS uses on-device Speech Recognition to type what you say. Audio stays on this Mac.';

/** Build the N-API bridge into the same out tree as its service, for development and packaging. */
export function buildAppleSpeech(output = 'out', arch = process.arch): void {
	if (process.platform !== 'darwin') { return; }
	const source = path.join(root, 'src/vs/platform/localTranscription/native/appleSpeech.mm');
	const directory = path.join(root, output, 'vs/platform/localTranscription/native');
	const binary = path.join(directory, 'appleSpeech.node');
	const stamp = `${binary}.sha256`;
	const hash = createHash('sha256').update(fs.readFileSync(source)).update(arch).digest('hex');
	if (fs.existsSync(binary) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === hash) { return; }
	const headers = getNodeGypHeadersDirectory(getElectronVersion(root).electronVersion);
	if (!headers) { throw new Error('Electron N-API headers are unavailable. Run pnpm install first.'); }
	fs.mkdirSync(directory, { recursive: true });
	execFileSync('/usr/bin/xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-mmacosx-version-min=14.0', '-arch', arch === 'arm64' ? 'arm64' : 'x86_64', '-bundle', '-undefined', 'dynamic_lookup', `-I${headers}`, '-framework', 'Foundation', '-framework', 'Speech', '-framework', 'AVFoundation', source, '-o', binary], { stdio: 'inherit' });
	fs.writeFileSync(stamp, hash);
}

/** Development Electron is not processed by the production signing task. Patch its plist before launch. */
export function prepareAppleSpeechDevelopmentApp(): void {
	if (process.platform !== 'darwin') { return; }
	const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8')) as { nameLong: string };
	const app = path.join(root, '.build/electron', `${product.nameLong}.app`);
	const plist = path.join(app, 'Contents/Info.plist');
	let previous = '';
	try { previous = execFileSync('/usr/bin/plutil', ['-extract', 'NSSpeechRecognitionUsageDescription', 'raw', plist], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* first build */ }
	if (previous === appleSpeechUsageDescription) { return; }
	execFileSync('/usr/bin/plutil', ['-replace', 'NSSpeechRecognitionUsageDescription', '-string', appleSpeechUsageDescription, plist]);
	// Preserve Electron's JIT entitlements while refreshing the local signature.
	execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements', app], { stdio: 'inherit' });
}

if (import.meta.main) {
	buildAppleSpeech(process.argv[2] ?? 'out');
	prepareAppleSpeechDevelopmentApp();
}
