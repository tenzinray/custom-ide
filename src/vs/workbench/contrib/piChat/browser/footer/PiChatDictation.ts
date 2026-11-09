/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../../../../base/browser/dom.js';
import { raceTimeout } from '../../../../../base/common/async.js';
import { Disposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { APPLE_SPEECH_MODEL, DEFAULT_LOCAL_TRANSCRIPTION_MODEL } from '../../../../../platform/localTranscription/common/localTranscription.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ChatSpeechToTextState, DICTATION_MODEL_SETTING, IChatSpeechToTextService } from '../../../chat/browser/speechToText/chatSpeechToTextService.js';
import { PiChatPromptInput } from './PiChatPromptInput.js';

type DictationPhase = 'idle' | 'starting' | 'listening' | 'stopping' | 'error';

/** Coordinates Pi's textarea with the canonical dictation service. Never locks typing or captures audio itself. */
export class PiChatDictation extends Disposable {
	private phase: DictationPhase = 'idle';
	private generation = 0;
	private ownsSession = false;
	private startOffset = 0;
	private insertedLength = 0;
	private needsLeadingSpace = false;
	private error = '';

	constructor(private readonly button: HTMLButtonElement, private readonly status: HTMLElement, private readonly prompt: PiChatPromptInput, private readonly speech: IChatSpeechToTextService, private readonly configuration: IConfigurationService, private readonly logService: ILogService) {
		super();
		this._register(speech.onDidUpdateTranscript(update => {
			if (this.ownsSession && this.phase === 'listening') { this.replace(update.text); }
		}));
		this._register(speech.onDidChangeState(state => {
			if (this.ownsSession && this.phase === 'listening' && state === ChatSpeechToTextState.Idle) { this.end(); }
			this.render();
		}));
		this._register(speech.onDidChangePreparingModel(() => {
			if (this.ownsSession && this.phase !== 'stopping' && speech.state === ChatSpeechToTextState.Recording && !speech.isPreparingModel) { this.setPhase('listening'); }
		}));
		this._register(configuration.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(DICTATION_MODEL_SETTING) || event.affectsConfiguration('dictation.enabled')) {
				if (this.ownsSession) { void this.stop(); }
				this.render();
			}
		}));
		const click = () => { if (this.phase === 'starting' || this.phase === 'listening') { void this.stop(); } else if (this.phase !== 'stopping') { void this.begin(); } };
		const input = () => { if (this.ownsSession) { void this.stop(true); } };
		button.addEventListener('click', click);
		prompt.input.addEventListener('input', input);
		this._register(toDisposable(() => { button.removeEventListener('click', click); prompt.input.removeEventListener('input', input); }));
		this.render();
	}

	private get localOnly(): boolean {
		const model = this.configuration.getValue<string>(DICTATION_MODEL_SETTING);
		return model === APPLE_SPEECH_MODEL || model === DEFAULT_LOCAL_TRANSCRIPTION_MODEL;
	}

	private async begin(): Promise<void> {
		if (!this.localOnly || !this.speech.isConfigured || this.speech.isBusy || this.prompt.input.disabled) { return; }
		const generation = ++this.generation;
		this.ownsSession = true;
		this.error = '';
		this.startOffset = this.prompt.input.selectionStart;
		this.insertedLength = this.prompt.input.selectionEnd - this.startOffset;
		this.needsLeadingSpace = this.startOffset > 0 && !/\s/.test(this.prompt.input.value[this.startOffset - 1]);
		this.setPhase('starting');
		try {
			const started = await raceTimeout(this.speech.start(getWindow(this.button), 'chat').then(() => true), 35_000);
			if (generation !== this.generation || this._store.isDisposed) { return; }
			if (!started) { throw new Error(localize('piChat.dictationTimeout', "Dictation did not start. Check Code - OSS microphone and Speech Recognition permissions in macOS settings.")); }
			if (this.speech.state === ChatSpeechToTextState.Recording) { this.setPhase(this.speech.isPreparingModel ? 'starting' : 'listening'); }
			else { this.end(); }
		} catch (error) {
			if (generation === this.generation && !this._store.isDisposed) {
				this.error = error instanceof Error ? error.message : String(error);
				this.logService.error('[pi-dictation] Start failed', error);
				void this.speech.cancel();
				this.end('error');
			}
		}
	}

	private async stop(cancel = false): Promise<void> {
		if (!this.ownsSession || this.phase === 'stopping') { return; }
		const wasStarting = this.phase === 'starting';
		const generation = ++this.generation;
		this.setPhase('stopping');
		try {
			if (cancel || wasStarting) { await raceTimeout(this.speech.cancel(), 3000); }
			else {
				const text = await raceTimeout(this.speech.stopAndTranscribe({ preserveLiveTranscript: true }), 5000);
				if (generation === this.generation && !this._store.isDisposed && text !== undefined) { this.replace(text); }
				if (this.speech.isBusy) { void this.speech.cancel(); }
			}
		} catch (error) { this.logService.error('[pi-dictation] Stop failed', error); }
		finally { if (generation === this.generation && !this._store.isDisposed) { this.end(); this.prompt.input.focus(); } }
	}

	private replace(text: string): void {
		const inserted = text && this.needsLeadingSpace ? ` ${text}` : text;
		this.prompt.replaceDictation(this.startOffset, this.insertedLength, inserted);
		this.insertedLength = inserted.length;
	}
	private end(phase: DictationPhase = 'idle'): void { this.ownsSession = false; this.setPhase(phase); }
	private setPhase(phase: DictationPhase): void {
		this.phase = phase;
		this.prompt.setDictating(phase === 'starting' || phase === 'listening' || phase === 'stopping');
		this.logService.info('[pi-dictation] State', phase);
		this.render();
	}

	private render(): void {
		const starting = this.phase === 'starting';
		const listening = this.phase === 'listening';
		const stopping = this.phase === 'stopping';
		const label = starting ? localize('piChat.dictationStarting', "Starting… Click to cancel") : listening ? localize('piChat.dictationListening', "Listening… Click to stop") : stopping ? localize('piChat.dictationStopping', "Finishing…") : this.phase === 'error' ? this.error : '';
		this.status.textContent = label;
		this.status.hidden = !label;
		this.prompt.input.parentElement!.dataset.dictation = this.phase;
		this.button.classList.toggle('codicon-mic', !starting && !stopping);
		this.button.classList.toggle('codicon-loading', starting || stopping);
		this.button.classList.toggle('codicon-modifier-spin', starting || stopping);
		this.button.setAttribute('aria-pressed', String(starting || listening));
		this.button.setAttribute('aria-label', label || localize('piChat.dictationStart', "Start dictation"));
		this.button.disabled = this.prompt.input.disabled || stopping || (!this.ownsSession && (!this.localOnly || !this.speech.isConfigured || this.speech.isBusy));
		this.button.title = !this.localOnly ? localize('piChat.dictationLocalOnly', "Select Apple Speech or Nemotron in Dictation: Model. Pi dictation never sends audio to the cloud.") : label || localize('piChat.dictationStart', "Start dictation");
	}

	override dispose(): void {
		this.generation++;
		if (this.ownsSession) { void this.speech.cancel(); this.prompt.setDictating(false); }
		this.ownsSession = false;
		super.dispose();
	}
}
