/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { ILocalTranscriptionResult, LocalTranscriptionModelState } from '../../common/localTranscription.js';
import { AppleSpeechNative, AppleSpeechService } from '../../electron-main/AppleSpeechService.js';

suite('AppleSpeechService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function setup(finalText = 'Hello world.', finalSpeechStart?: number) {
		let callback: Parameters<AppleSpeechNative['start']>[1] | undefined;
		const audio: Uint8Array[] = [];
		let cancellations = 0;
		const native: AppleSpeechNative = {
			start: (_language, handler) => { callback = handler; },
			append: chunk => { audio.push(chunk); },
			finish: () => { callback?.('final', finalText, finalSpeechStart); },
			cancel: () => { cancellations++; },
		};
		const service = store.add(new AppleSpeechService(native, new NullLogService()));
		return { service, audio, emit: (kind: Parameters<Parameters<AppleSpeechNative['start']>[1]>[0], text = '', speechStart?: number) => callback?.(kind, text, speechStart), get cancellations() { return cancellations; } };
	}

	test('waits for native readiness and streams partial and final transcripts', async () => {
		const { service, audio, emit } = setup();
		const results: ILocalTranscriptionResult[] = [];
		store.add(service.onDidTranscribe(result => results.push(result)));
		const start = service.start({ cacheDir: '', language: 'en-US' });
		assert.strictEqual((await service.getModelStatus()).state, LocalTranscriptionModelState.Loading);
		emit('ready');
		await start;
		emit('transcript', 'Hello');
		await service.pushAudio(VSBuffer.wrap(new Uint8Array([0, 0])));
		const text = await service.stop();
		assert.deepStrictEqual({ results, text, audio: audio.map(chunk => [...chunk]), state: (await service.getModelStatus()).state }, {
			results: [{ text: 'Hello', isFinal: false, finalizedText: '' }, { text: 'Hello world.', isFinal: true, finalizedText: 'Hello world.' }],
			text: 'Hello world.', audio: [[0, 0]], state: LocalTranscriptionModelState.Idle,
		});
	});

	test('appends speech after a pause while replacing revisions within the same utterance', async () => {
		const { service, emit } = setup('Second sentence!', 4);
		const results: string[] = [];
		store.add(service.onDidTranscribe(result => results.push(result.text)));
		const start = service.start({ cacheDir: '' });
		emit('ready');
		await start;
		emit('transcript', 'Hello');
		emit('segment', 'Hello world.', 0.5);
		emit('transcript', 'Second');
		emit('transcript', 'Second sent');
		emit('segment', 'Second sentence.', 4);
		emit('segment', 'Second sentence!', 4);
		const text = await service.stop();
		assert.deepStrictEqual({ results, text }, {
			results: ['Hello', 'Hello world.', 'Hello world. Second', 'Hello world. Second sent', 'Hello world. Second sentence.', 'Hello world. Second sentence!', 'Hello world. Second sentence!'],
			text: 'Hello world. Second sentence!',
		});
	});

	test('also accepts cumulative Apple snapshots without duplicating committed words', async () => {
		const { service, emit } = setup('Hello world. Next sentence.', 0.5);
		const start = service.start({ cacheDir: '' });
		emit('ready');
		await start;
		emit('segment', 'Hello world.', 0.5);
		emit('transcript', 'Hello world. Next');
		assert.strictEqual(await service.stop(), 'Hello world. Next sentence.');
	});

	test('preserves repeated phrases spoken as separate utterances', async () => {
		const { service, emit } = setup('Hello.', 4);
		const start = service.start({ cacheDir: '' });
		emit('ready');
		await start;
		emit('segment', 'Hello.', 0.5);
		emit('segment', 'Hello.', 4);
		assert.strictEqual(await service.stop(), 'Hello. Hello.');
	});

	test('an empty native task final preserves utterances settled before a pause', async () => {
		const { service, emit } = setup('', -1);
		const start = service.start({ cacheDir: '' });
		emit('ready');
		await start;
		emit('segment', 'The first phrase.', 0);
		emit('transcript', 'Now the second');
		emit('segment', 'Now the second phrase.', 9.69);
		assert.strictEqual(await service.stop(), 'The first phrase. Now the second phrase.');
	});

	test('cancel during permission startup settles start and permits a second session', async () => {
		const fixture = setup();
		const start = fixture.service.start({ cacheDir: '' });
		const rejected = assert.rejects(start, /Canceled/);
		await fixture.service.cancel();
		await rejected;
		const next = fixture.service.start({ cacheDir: '' });
		fixture.emit('ready');
		await next;
		assert.deepStrictEqual({ state: (await fixture.service.getModelStatus()).state, cancellations: fixture.cancellations }, { state: LocalTranscriptionModelState.Ready, cancellations: 1 });
	});

	test('reports native startup failure and releases resources', async () => {
		const fixture = setup();
		const start = fixture.service.start({ cacheDir: '' });
		fixture.emit('error', 'Permission denied');
		await assert.rejects(start, /Permission denied/);
		assert.deepStrictEqual({ state: (await fixture.service.getModelStatus()).state, cancellations: fixture.cancellations }, { state: LocalTranscriptionModelState.Error, cancellations: 1 });
	});

	test('ignores late native callbacks from a cancelled session', async () => {
		let oldCallback: Parameters<AppleSpeechNative['start']>[1] | undefined;
		const native: AppleSpeechNative = { start: (_language, handler) => { oldCallback = handler; handler('ready', ''); }, append: () => {}, finish: () => {}, cancel: () => {} };
		const service = store.add(new AppleSpeechService(native, new NullLogService()));
		const results: ILocalTranscriptionResult[] = [];
		store.add(service.onDidTranscribe(result => results.push(result)));
		await service.start({ cacheDir: '' });
		await service.cancel();
		oldCallback?.('transcript', 'Must not enter the next draft');
		assert.deepStrictEqual(results, []);
	});
});
