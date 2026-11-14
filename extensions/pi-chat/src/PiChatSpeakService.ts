/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import type { PiChatPlaybackStatus, PiChatSpeakRequest } from '../../../src/vs/workbench/contrib/piChat/common/pi-chat-playback-types.js';

/** Script controls inspect its exact active utterance; text goes over stdin, not through a shell. */
function controlSpeech(script: string, action: '--status' | '--pause' | '--resume', text: string): Promise<PiChatPlaybackStatus['phase']> {
	return new Promise((resolve, reject) => {
		const child = spawn(script, [action], { stdio: ['pipe', 'pipe', 'pipe'] });
		let output = '';
		let error = '';
		const timeout = setTimeout(() => { child.kill(); reject(new Error(vscode.l10n.t('Siri playback control timed out.'))); }, 5000);
		child.stdout.setEncoding('utf8').on('data', (value: string) => { output += value; });
		child.stderr.setEncoding('utf8').on('data', (value: string) => { error += value; });
		child.on('error', cause => { clearTimeout(timeout); reject(cause); });
		child.on('close', code => {
			clearTimeout(timeout);
			const phase = output.trim();
			if (code !== 0) { reject(new Error(error || vscode.l10n.t('Could not control Siri playback.'))); }
			else if (phase === 'playing' || phase === 'paused' || phase === 'generating' || phase === 'idle') { resolve(phase); }
			else { reject(new Error(vscode.l10n.t('Unexpected Siri playback status.'))); }
		});
		child.stdin.on('error', () => {});
		child.stdin.end(text);
	});
}

/** Live agent speech uses the script player; replay reuses the existing Pi Listen player. */
export function registerPiChatSpeakCommands(context: vscode.ExtensionContext, script: string, playbackStatus: () => PiChatPlaybackStatus): void {
	const status = async (request: PiChatSpeakRequest): Promise<PiChatPlaybackStatus> => {
		const replay = playbackStatus();
		if (replay.playbackId === request.id && replay.phase !== 'idle') { return replay; }
		return { phase: await controlSpeech(script, '--status', request.text), playbackId: request.id };
	};
	context.subscriptions.push(vscode.commands.registerCommand('piChat.speakStatuses', async (requests: readonly PiChatSpeakRequest[]) => {
		const phases = new Map<string, Promise<PiChatPlaybackStatus['phase']>>();
		const replay = playbackStatus();
		return Promise.all(requests.map(request => {
			if (replay.playbackId === request.id && replay.phase !== 'idle') { return replay; }
			let phase = phases.get(request.text);
			if (!phase) { phase = controlSpeech(script, '--status', request.text); phases.set(request.text, phase); }
			return phase.then(phase => ({ phase, playbackId: request.id }));
		}));
	}));
	context.subscriptions.push(vscode.commands.registerCommand('piChat.toggleSpeak', async (request: PiChatSpeakRequest): Promise<PiChatPlaybackStatus> => {
		const current = await status(request);
		if (current.phase === 'generating') { return current; }
		if (current.phase === 'playing' || current.phase === 'paused') {
			if (playbackStatus().playbackId === request.id) {
				return vscode.commands.executeCommand(current.phase === 'playing' ? 'piChat.pause' : 'piChat.resume', request.id);
			}
			return { phase: await controlSpeech(script, current.phase === 'playing' ? '--pause' : '--resume', request.text), playbackId: request.id };
		}
		return vscode.commands.executeCommand('piChat.listen', request.text, request.id);
	}));
}
