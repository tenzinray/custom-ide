/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';
import { spawn, execFile, ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import type { PiChatPlaybackStatus } from '../../../src/vs/workbench/contrib/piChat/common/pi-chat-playback-types.js';
import { changePiChatOpenAIAccount, getPiChatOpenAIAccounts } from './PiChatOpenAIAccountService.js';
import { fetchPiChatOpenAILimits } from './PiChatOpenAILimitsService.js';
import { getPiChatContextUsage } from './PiChatContextUsageService.js';
import { cancelPiChatPrompt, createPiChatSession, disposePiChatRuns, pollPiChatTurn, queuePiChatPrompt, renamePiChatSession, restorePiChatDraft, sendPiChatPromptNow, startPiChatTurn, stopPiChatTurn } from './PiChatRunService.js';

const script = join(__dirname, '..', 'siri-tts.sh');
let generation = 0;
let generating: ChildProcessWithoutNullStreams | undefined;
let playing: ChildProcessWithoutNullStreams | undefined;
let status: PiChatPlaybackStatus = { phase: 'idle' };
let elapsedMs = 0;
let startedAt = 0;

function stop(): void {
	generation++;
	generating?.kill();
	if (playing) {
		if (status.phase === 'paused') { playing.kill('SIGCONT'); }
		playing.kill();
	}
	generating = playing = undefined;
	status = { phase: 'idle' };
}

function playbackStatus(): PiChatPlaybackStatus {
	return status.phase === 'playing' || status.phase === 'paused'
		? { ...status, positionMs: Math.min(status.durationMs || Infinity, elapsedMs + (status.phase === 'playing' ? Date.now() - startedAt : 0)) }
		: status;
}

function generate(text: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = generating = spawn(script, ['--file']);
		let audio = '';
		let error = '';
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => { audio += chunk; });
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => { error += chunk; });
		child.on('error', reject);
		child.on('close', code => {
			if (generating === child) { generating = undefined; }
			if (code === 0 && audio.trim()) { resolve(audio.trim()); }
			else { reject(new Error(error.trim() || 'Siri TTS did not generate audio.')); }
		});
		child.stdin.on('error', () => {}); // A canceled generation may close stdin early.
		child.stdin.end(text);
	});
}

function audioDuration(audio: string): Promise<number> {
	return new Promise(resolve => {
		execFile('afinfo', [audio], { timeout: 3000 }, (_error, output) => {
			const duration = /estimated duration: ([\d.]+) sec/.exec(output)?.[1];
			resolve(duration ? Number(duration) * 1000 : 0);
		});
	});
}

function play(audio: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = playing = spawn('afplay', [audio]);
		child.on('error', reject);
		child.on('close', code => {
			if (playing === child) { playing = undefined; }
			if (code === 0) { resolve(); }
			else { reject(new Error('Audio playback stopped.')); }
		});
	});
}

export function activate(context: vscode.ExtensionContext): void {
	// The same bundled OAuth loaders Pi uses for its standalone binary keep flow imports inside our ESM bundle.
	registerBunOAuthFlows();
	context.subscriptions.push(vscode.commands.registerCommand('piChat.openAIAccounts', getPiChatOpenAIAccounts));
	context.subscriptions.push(vscode.commands.registerCommand('piChat.changeOpenAIAccount', changePiChatOpenAIAccount));
	context.subscriptions.push(vscode.commands.registerCommand('piChat.createSession', createPiChatSession));
	context.subscriptions.push(vscode.commands.registerCommand('piChat.restoreDraft', restorePiChatDraft));
	context.subscriptions.push(vscode.commands.registerCommand('piChat.renameSession', renamePiChatSession));
	context.subscriptions.push(vscode.commands.registerCommand('piChat.startTurn', startPiChatTurn));
	context.subscriptions.push(vscode.commands.registerCommand('piChat.pollTurn', pollPiChatTurn));
	context.subscriptions.push(vscode.commands.registerCommand('piChat.openAILimits', fetchPiChatOpenAILimits));
	context.subscriptions.push(vscode.commands.registerCommand('piChat.contextUsage', getPiChatContextUsage));
	context.subscriptions.push(vscode.commands.registerCommand('piChat.queuePrompt', queuePiChatPrompt));
	context.subscriptions.push(vscode.commands.registerCommand('piChat.cancelPrompt', cancelPiChatPrompt));
	context.subscriptions.push(vscode.commands.registerCommand('piChat.sendPromptNow', sendPiChatPromptNow));
	context.subscriptions.push(vscode.commands.registerCommand('piChat.stopTurn', stopPiChatTurn));
	context.subscriptions.push({ dispose: disposePiChatRuns });
	context.subscriptions.push(vscode.commands.registerCommand('piChat.listen', (text: unknown, playbackId: unknown): PiChatPlaybackStatus => {
		if (typeof text !== 'string' || !text.trim() || typeof playbackId !== 'string') { return playbackStatus(); }
		stop();
		const current = generation;
		status = { phase: 'generating', playbackId };
		void (async () => {
			try {
				const audio = await generate(text);
				if (current !== generation) { return; }
				const durationMs = await audioDuration(audio);
				if (current !== generation) { return; }
				elapsedMs = 0;
				startedAt = Date.now();
				status = { phase: 'playing', playbackId, durationMs };
				await play(audio);
			} catch (error) {
				if (current === generation) { vscode.window.showErrorMessage(`Pi Listen: ${error instanceof Error ? error.message : 'Could not play response.'}`); }
		} finally {
				if (current === generation) { status = { phase: 'idle' }; }
		}
		})();
		return playbackStatus();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('piChat.playbackStatus', playbackStatus));
	context.subscriptions.push(vscode.commands.registerCommand('piChat.pause', (playbackId: string) => {
		if (playbackId === status.playbackId && status.phase === 'playing' && playing) {
			elapsedMs += Date.now() - startedAt;
			playing.kill('SIGSTOP');
			status = { ...status, phase: 'paused' };
		}
		return playbackStatus();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('piChat.resume', (playbackId: string) => {
		if (playbackId === status.playbackId && status.phase === 'paused' && playing) {
			playing.kill('SIGCONT');
			startedAt = Date.now();
			status = { ...status, phase: 'playing' };
		}
		return playbackStatus();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('piChat.stop', (playbackId: string) => {
		if (playbackId === status.playbackId) { stop(); }
		return playbackStatus();
	}));
	context.subscriptions.push({ dispose: stop });
}
