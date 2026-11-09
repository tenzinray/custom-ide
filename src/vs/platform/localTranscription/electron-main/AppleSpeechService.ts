/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FileAccess } from '../../../base/common/network.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { DeferredPromise, raceTimeout, RunOnceScheduler } from '../../../base/common/async.js';
import { CancellationError } from '../../../base/common/errors.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { ILocalTranscriptionModelStatus, ILocalTranscriptionResult, ILocalTranscriptionService, LocalTranscriptionModelState } from '../common/localTranscription.js';

/** N-API boundary only. PCM format and transcript contracts remain owned by ILocalTranscriptionService. */
export interface AppleSpeechNative {
	start(language: string, callback: (kind: 'ready' | 'transcript' | 'segment' | 'final' | 'error', text: string, speechStart?: number) => void): void;
	append(audio: Uint8Array): void;
	finish(): void;
	cancel(): void;
}

/** Apple Speech runs in the real macOS application, using its permissions and main run loop.
 * Owns recognition only; the existing renderer service owns microphone capture and UI.
 */
export class AppleSpeechService extends Disposable implements ILocalTranscriptionService {
	declare readonly _serviceBrand: undefined;
	readonly isSupported = true;
	private status: ILocalTranscriptionModelStatus = { state: LocalTranscriptionModelState.Idle };
	private readonly statusEmitter = this._register(new Emitter<ILocalTranscriptionModelStatus>());
	readonly onDidChangeModelStatus = this.statusEmitter.event;
	private readonly transcriptEmitter = this._register(new Emitter<ILocalTranscriptionResult>());
	readonly onDidTranscribe = this.transcriptEmitter.event;
	private session: { text: string; segments: Map<number, string>; ready: DeferredPromise<void>; final: DeferredPromise<void>; stopping: boolean } | undefined;
	private readonly captureWatchdog = this._register(new RunOnceScheduler(() => {
		this.logService.warn('[apple-speech] Capture stopped sending audio; releasing the session');
		void this.cancel();
	}, 10_000));

	constructor(private native: AppleSpeechNative | undefined, @ILogService private readonly logService: ILogService) { super(); }

	async getModelStatus(): Promise<ILocalTranscriptionModelStatus> { return this.status; }

	async importModel(): ReturnType<ILocalTranscriptionService['importModel']> { throw new Error('Apple Speech languages are managed in macOS Keyboard → Dictation settings.'); }

	async start(options: Parameters<ILocalTranscriptionService['start']>[0]): Promise<void> {
		if (this.session) { throw new Error('Apple Speech is already in use by another dictation session.'); }
		const session = this.session = { text: '', segments: new Map<number, string>(), ready: new DeferredPromise<void>(), final: new DeferredPromise<void>(), stopping: false };
		// Cancellation can happen before native startup has installed its awaiter.
		void session.ready.p.catch(() => {});
		this.setStatus({ state: LocalTranscriptionModelState.Loading });
		this.logService.info('[apple-speech] Starting on-device recognition', options.language ?? 'en-US');
		try {
			if (!this.native) {
				const { createRequire } = await import('node:module');
				if (this.session !== session) { throw new CancellationError(); }
				this.native = createRequire(import.meta.url)(FileAccess.asFileUri('vs/platform/localTranscription/native/appleSpeech.node').fsPath) as AppleSpeechNative;
			}
			this.native.start(options.language ?? 'en-US', (kind, text, speechStart) => {
				if (this.session !== session) { return; }
				if (kind === 'ready') {
					this.logService.info('[apple-speech] Recognizer ready');
					this.setStatus({ state: LocalTranscriptionModelState.Ready });
					this.captureWatchdog.schedule();
					void session.ready.complete();
				} else if (kind === 'transcript' || kind === 'segment' || kind === 'final') {
					// Apple resets partial text after a settled utterance. Preserve those
					// utterances by native audio timestamp; revisions replace the same
					// segment, while speech after a pause appends a new one.
					const timedSegment = kind !== 'transcript' && speechStart !== undefined && speechStart >= 0;
					if (timedSegment) { session.segments.set(speechStart, text); }
					const committed = [...session.segments].sort(([a], [b]) => a - b).map(([, value]) => value).filter(Boolean).join(' ');
					session.text = timedSegment ? committed : text.startsWith(committed) ? text : [committed, text].filter(Boolean).join(' ');
					this.logService.trace('[apple-speech] Transcript update', kind, session.text.length);
					this.transcriptEmitter.fire({ text: session.text, isFinal: kind === 'final', finalizedText: kind === 'final' ? session.text : committed });
					if (kind === 'final') { void session.final.complete(); }
				} else if (kind === 'error') {
					if (session.stopping) { void session.final.complete(); return; }
					this.logService.error('[apple-speech] Recognition failed', text);
					if (!session.ready.isSettled) { void session.ready.error(new Error(text)); }
					this.setStatus({ state: LocalTranscriptionModelState.Error, error: text, errorCode: 'runtime' });
				}
			});
			const ready = await raceTimeout(session.ready.p.then(() => true), 30_000);
			if (!ready) { throw new Error('Apple Speech did not start within 30 seconds. Check Speech Recognition permission for Code - OSS in macOS Privacy & Security settings.'); }
		} catch (error) {
			if (this.session === session) {
				await this.cancel();
				this.setStatus({ state: LocalTranscriptionModelState.Error, error: String(error), errorCode: 'runtime' });
			}
			throw error;
		}
	}

	async pushAudio(chunk: VSBuffer): Promise<void> {
		if (this.session) { this.native?.append(chunk.buffer); this.captureWatchdog.schedule(); }
	}

	async stop(): Promise<string> {
		const session = this.session;
		if (!session) { return ''; }
		session.stopping = true;
		this.native?.finish();
		try {
			await raceTimeout(session.final.p, 2000);
			return session.text;
		} finally { if (this.session === session) { await this.cancel(); } }
	}

	async cancel(): Promise<void> {
		const session = this.session;
		this.session = undefined;
		this.captureWatchdog.cancel();
		this.native?.cancel();
		if (session && !session.ready.isSettled) { void session.ready.error(new CancellationError()); }
		this.logService.info('[apple-speech] Session released');
		this.setStatus({ state: LocalTranscriptionModelState.Idle });
	}

	private setStatus(status: ILocalTranscriptionModelStatus): void { this.status = status; this.statusEmitter.fire(status); }

	override dispose(): void { void this.cancel(); super.dispose(); }
}
