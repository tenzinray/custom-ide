/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { timeout } from '../../../../../base/common/async.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { getPiChatSpeakText } from '../../common/piChatSpeakCommand.js';
import { PiChatPlaybackStatus, PiChatSpeakRequest } from '../../common/pi-chat-playback-types.js';
import { PiChatMessage } from '../../common/pi-chat-types.js';
import { renderPiChatTool } from '../../browser/body/PiChatToolMessage.js';
import { PiChatSpeakPlayback } from '../../browser/body/PiChatSpeakPlayback.js';
import '../../browser/media/piChat.css';

suite('PiChatSpeak', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const tool: Extract<PiChatMessage, { kind: 'tool' }> = { id: 'speech', role: 'assistant', kind: 'tool', toolName: 'bash', input: '/Users/test/.local/bin/siri-tts.sh "Hello there" >/dev/null 2>&1 &', output: 'raw command output', state: 'completed' };

	test('parses literal shell quoting and harmless redirects but never evaluates shell code', () => {
		assert.deepStrictEqual([
			tool.input, `siri-tts.sh 'Hello there'`, `bash /repo/extensions/pi-chat/siri-tts.sh "Hello \\"friend\\""`,
			`/repo/siri-tts.sh 'It'"'"'s done'`, `siri-tts.sh --file "Not played"`,
			`echo 'siri-tts.sh hello'`, `siri-tts.sh "$(cat secret)"`, `siri-tts.sh "hello" && rm file`,
		].map(getPiChatSpeakText), ['Hello there', 'Hello there', 'Hello "friend"', `It's done`, undefined, undefined, undefined, undefined]);
	});

	test('Speak tool shows only spoken text in its target and disclosure, ordinary commands remain unchanged', () => {
		const host = mainWindow.document.createElement('div');
		renderPiChatTool(host, tool);
		const speak = { label: host.querySelector('strong')?.textContent, target: host.querySelector('.pi-chat-activity-target')?.textContent, preview: host.querySelector('pre')?.textContent, speechIcon: !!host.querySelector('button .codicon-unmute'), leaksCommand: host.textContent?.includes('siri-tts.sh') };
		const normal = mainWindow.document.createElement('div');
		renderPiChatTool(normal, { ...tool, input: 'git status' });
		assert.deepStrictEqual({ speak, normal: normal.querySelector('strong')?.textContent }, {
			speak: { label: 'Speak', target: 'Hello there', preview: 'Hello there', speechIcon: true, leaksCommand: false }, normal: 'Command',
		});
	});

	test('original playback pauses/resumes from its icon and survives a streaming node replacement', async () => {
		let phase: PiChatPlaybackStatus['phase'] = 'playing';
		const calls: string[] = [];
		const commands = new class extends mock<ICommandService>() {
			override async executeCommand<T>(id: string, request: PiChatSpeakRequest | PiChatSpeakRequest[]): Promise<T> {
				calls.push(id);
				if (id === 'piChat.speakStatuses') { return [{ phase, playbackId: 'speak:speech' }] as T; }
				phase = phase === 'playing' ? 'paused' : 'playing';
				return { phase, playbackId: (request as PiChatSpeakRequest).id } as T;
			}
		}();
		const playback = store.add(new PiChatSpeakPlayback(commands, new class extends mock<INotificationService>() { override error(): void { assert.fail('Unexpected playback error'); } }()));
		const host = mainWindow.document.createElement('div');
		host.className = 'monaco-workbench';
		host.style.cssText = '--vscode-descriptionForeground:#999999; --vscode-charts-green:#00aa00;';
		mainWindow.document.body.append(host);
		store.add(toDisposable(() => host.remove()));
		renderPiChatTool(host, tool);
		const render = store.add(new DisposableStore());
		playback.connect(host, render);
		await timeout(0);
		let button = host.querySelector<HTMLButtonElement>('button')!;
		const playing = button.classList.contains('pi-chat-speak-playing') && !!button.querySelector('.codicon-debug-pause');
		const playingColor = mainWindow.getComputedStyle(button.firstElementChild!).color;
		button.click();
		await timeout(0);
		const paused = !button.classList.contains('pi-chat-speak-playing') && button.getAttribute('aria-label') === 'Resume speech';
		const pausedColor = mainWindow.getComputedStyle(button.firstElementChild!).color;
		button.click();
		await timeout(0);
		render.dispose();
		host.replaceChildren();
		renderPiChatTool(host, tool);
		playback.connect(host, store.add(new DisposableStore()));
		button = host.querySelector<HTMLButtonElement>('button')!;
		assert.deepStrictEqual({ playing, paused, playingColor, pausedColor, retainedPlaying: !!button.querySelector('.codicon-debug-pause'), expanded: host.querySelector('details')?.open, calls }, {
			playing: true, paused: true, playingColor: 'rgb(0, 170, 0)', pausedColor: 'rgb(153, 153, 153)', retainedPlaying: true, expanded: false, calls: ['piChat.speakStatuses', 'piChat.toggleSpeak', 'piChat.toggleSpeak'],
		});
	});
});
