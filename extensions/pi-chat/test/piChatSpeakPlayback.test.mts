/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, watch, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { activatePiChatTestExtension } from './piChatExtensionTestHost.mts';
import type { PiChatPlaybackStatus } from '../../../src/vs/workbench/contrib/piChat/common/pi-chat-playback-types.js';

// Silent audio exercises the real afplay PID controls without invoking Siri or speaking test content.
test('Speak controls the original script player, then reuses Listen for replay', { skip: process.platform !== 'darwin', timeout: 15_000 }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'pi-chat-speak-'));
	const previousCache = process.env.XDG_CACHE_HOME;
	process.env.XDG_CACHE_HOME = root;
	const host = await activatePiChatTestExtension();
	const script = resolve(import.meta.dirname, '../siri-tts.sh');
	const text = 'silent playback test';
	const request = { id: 'speak:test', text };
	const hash = createHash('sha256').update(text).digest('hex');
	const folder = join(root, 'pi-chat', 'tts', 'msgs');
	let child: ReturnType<typeof spawn> | undefined;
	try {
		await mkdir(folder, { recursive: true });
		const audio = Buffer.alloc(44 + 16_000 * 2 * 8);
		audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
		audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
		audio.writeUInt32LE(16_000, 24); audio.writeUInt32LE(32_000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
		audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
		await writeFile(join(folder, `${hash}.m4a`), audio);
		const controller = new AbortController();
		const ready = (async () => {
			for await (const event of watch(folder, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) })) {
				if (event.filename === `${hash}.m4a.pid` && /^\d+\s*$/.test(await readFile(join(folder, event.filename), 'utf8').catch(() => ''))) { return; }
			}
		})();
		child = spawn(script, [text], { env: process.env, stdio: 'ignore' });
		const exited = once(child, 'exit');
		await ready;
		controller.abort();
		const statuses = host.commands.get('piChat.speakStatuses')!;
		const toggle = host.commands.get('piChat.toggleSpeak')!;
		const playing = await statuses([request]) as PiChatPlaybackStatus[];
		const paused = await toggle(request) as PiChatPlaybackStatus;
		const resumed = await toggle(request) as PiChatPlaybackStatus;
		const stop = spawn(script, ['--stop', text], { env: process.env, stdio: 'ignore' });
		await once(stop, 'exit');
		await exited;
		const replays: string[] = [];
		host.commands.set('piChat.listen', (spoken: string, id: string) => { replays.push(spoken); return { phase: 'generating', playbackId: id }; });
		const replay = await toggle(request) as PiChatPlaybackStatus;
		assert.deepStrictEqual({ playing: playing[0].phase, paused: paused.phase, resumed: resumed.phase, replay: replay.phase, replays, errors: host.errors }, {
			playing: 'playing', paused: 'paused', resumed: 'playing', replay: 'generating', replays: [text], errors: [],
		});
	} finally {
		child?.kill('SIGTERM');
		host.dispose();
		if (previousCache === undefined) { delete process.env.XDG_CACHE_HOME; } else { process.env.XDG_CACHE_HOME = previousCache; }
		await rm(root, { recursive: true, force: true });
	}
});
