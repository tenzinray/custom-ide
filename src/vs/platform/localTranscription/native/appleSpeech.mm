/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

#include <node_api.h>
#include <memory>
#include <string>
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <Speech/Speech.h>

// All Speech state lives on Electron's main thread. Only the thread-safe JS
// callback crosses into Node; no native callback ever touches a napi_env.
struct SpeechEvent {
	std::string kind;
	std::string text;
	double speechStart;
};

struct SpeechSession {
	napi_threadsafe_function callback = nullptr;
	SFSpeechRecognizer *recognizer = nil;
	SFSpeechAudioBufferRecognitionRequest *request = nil;
	SFSpeechRecognitionTask *task = nil;
	bool closed = false;

	void emit(const char *kind, NSString *text = nil, double speechStart = -1) {
		if (closed) { return; }
		auto event = new SpeechEvent{kind, text ? text.UTF8String : "", speechStart};
		if (napi_call_threadsafe_function(callback, event, napi_tsfn_nonblocking) != napi_ok) { delete event; }
	}

	void close() {
		if (closed) { return; }
		closed = true;
		[task cancel];
		task = nil;
		request = nil;
		recognizer = nil;
		napi_release_threadsafe_function(callback, napi_tsfn_release);
	}
};

static std::shared_ptr<SpeechSession> active;

static void callJs(napi_env env, napi_value callback, void *, void *data) {
	std::unique_ptr<SpeechEvent> event(static_cast<SpeechEvent *>(data));
	if (!env || !callback) { return; }
	napi_value receiver, args[3], result;
	napi_get_undefined(env, &receiver);
	napi_create_string_utf8(env, event->kind.c_str(), NAPI_AUTO_LENGTH, &args[0]);
	napi_create_string_utf8(env, event->text.c_str(), NAPI_AUTO_LENGTH, &args[1]);
	napi_create_double(env, event->speechStart, &args[2]);
	napi_call_function(env, receiver, callback, 3, args, &result);
}

static void beginRecognition(const std::shared_ptr<SpeechSession> &session, NSString *language) {
	if (session->closed) { return; }
	session->recognizer = [[SFSpeechRecognizer alloc] initWithLocale:[[NSLocale alloc] initWithLocaleIdentifier:language]];
	if (!session->recognizer.available || !session->recognizer.supportsOnDeviceRecognition) {
		session->emit("error", @"Apple on-device recognition is unavailable for this language. Enable and download Dictation for this language in macOS Keyboard settings.");
		return;
	}
	session->request = [SFSpeechAudioBufferRecognitionRequest new];
	session->request.requiresOnDeviceRecognition = YES;
	session->request.shouldReportPartialResults = YES;
	session->request.taskHint = SFSpeechRecognitionTaskHintDictation;
	std::weak_ptr<SpeechSession> weakSession = session;
	session->task = [session->recognizer recognitionTaskWithRequest:session->request resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
		dispatch_async(dispatch_get_main_queue(), ^{
			auto current = weakSession.lock();
			if (!current || current->closed) { return; }
			if (result) {
				// On-device Speech can finish an utterance after silence without
				// finishing the task. Its next partial then contains only new words.
				// Keep the timed utterance boundary instead of treating every result
				// as a cumulative transcript of the entire microphone session.
				bool settled = result.speechRecognitionMetadata != nil && result.bestTranscription.segments.lastObject.confidence > 0;
				const char *kind = result.isFinal ? "final" : settled ? "segment" : "transcript";
				double start = result.speechRecognitionMetadata ? result.speechRecognitionMetadata.speechStartTimestamp : -1;
				current->emit(kind, result.bestTranscription.formattedString, start);
			}
			if (error) { current->emit("error", error.localizedDescription); }
		});
	}];
	session->emit("ready");
}

static napi_value start(napi_env env, napi_callback_info info) {
	size_t argc = 2;
	napi_value args[2], resourceName;
	napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
	napi_valuetype type;
	if (argc != 2 || napi_typeof(env, args[1], &type) != napi_ok || type != napi_function) {
		napi_throw_type_error(env, nullptr, "start requires a language and callback"); return nullptr;
	}
	if (active) { napi_throw_error(env, nullptr, "An Apple Speech session is already active"); return nullptr; }
	if (![[NSBundle mainBundle] objectForInfoDictionaryKey:@"NSSpeechRecognitionUsageDescription"]) {
		napi_throw_error(env, nullptr, "Code - OSS is missing NSSpeechRecognitionUsageDescription. Rebuild its macOS app bundle before using Apple Speech."); return nullptr;
	}
	char language[128];
	if (napi_get_value_string_utf8(env, args[0], language, sizeof(language), nullptr) != napi_ok) {
		napi_throw_type_error(env, nullptr, "language must be a string"); return nullptr;
	}
	auto session = std::make_shared<SpeechSession>();
	napi_create_string_utf8(env, "AppleSpeech", NAPI_AUTO_LENGTH, &resourceName);
	if (napi_create_threadsafe_function(env, args[1], nullptr, resourceName, 0, 1, nullptr, nullptr, nullptr, callJs, &session->callback) != napi_ok) {
		napi_throw_error(env, nullptr, "Could not create the Apple Speech callback"); return nullptr;
	}
	napi_unref_threadsafe_function(env, session->callback);
	active = session;
	NSString *locale = [NSString stringWithUTF8String:language];
	auto status = [SFSpeechRecognizer authorizationStatus];
	if (status == SFSpeechRecognizerAuthorizationStatusAuthorized) {
		beginRecognition(session, locale);
	} else if (status == SFSpeechRecognizerAuthorizationStatusNotDetermined) {
		[SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus resolved) {
			dispatch_async(dispatch_get_main_queue(), ^{
				if (session->closed) { return; }
				if (resolved == SFSpeechRecognizerAuthorizationStatusAuthorized) { beginRecognition(session, locale); }
				else { session->emit("error", @"Allow Speech Recognition for Code - OSS in System Settings → Privacy & Security."); }
			});
		}];
	} else {
		session->emit("error", @"Allow Speech Recognition for Code - OSS in System Settings → Privacy & Security.");
	}
	return nullptr;
}

static napi_value append(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value args[1];
	napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
	void *data = nullptr;
	size_t length = 0;
	if (argc != 1 || napi_get_buffer_info(env, args[0], &data, &length) != napi_ok || length % 2) {
		napi_throw_type_error(env, nullptr, "append requires PCM16 mono audio"); return nullptr;
	}
	if (!active || active->closed || !active->request || !length) { return nullptr; }
	auto frames = static_cast<AVAudioFrameCount>(length / 2);
	AVAudioFormat *format = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatFloat32 sampleRate:16000 channels:1 interleaved:NO];
	AVAudioPCMBuffer *buffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:format frameCapacity:frames];
	buffer.frameLength = frames;
	const int16_t *samples = static_cast<const int16_t *>(data);
	for (AVAudioFrameCount i = 0; i < frames; i++) { buffer.floatChannelData[0][i] = samples[i] / 32768.0f; }
	[active->request appendAudioPCMBuffer:buffer];
	return nullptr;
}

static napi_value finish(napi_env env, napi_callback_info info) {
	if (active && !active->closed) { [active->request endAudio]; }
	return nullptr;
}

static napi_value cancel(napi_env env, napi_callback_info info) {
	if (active) { active->close(); active.reset(); }
	return nullptr;
}

static napi_value init(napi_env env, napi_value exports) {
	napi_property_descriptor properties[] = {
		{"start", nullptr, start, nullptr, nullptr, nullptr, napi_default, nullptr},
		{"append", nullptr, append, nullptr, nullptr, nullptr, napi_default, nullptr},
		{"finish", nullptr, finish, nullptr, nullptr, nullptr, napi_default, nullptr},
		{"cancel", nullptr, cancel, nullptr, nullptr, nullptr, napi_default, nullptr}
	};
	napi_define_properties(env, exports, 4, properties);
	napi_add_env_cleanup_hook(env, [](void *) { if (active) { active->close(); active.reset(); } }, nullptr);
	return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
