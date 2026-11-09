/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, getWindow } from '../../../../base/browser/dom.js';
import { URI } from '../../../../base/common/uri.js';
import { IntervalTimer } from '../../../../base/common/async.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IMarkdownRendererService } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { PiChatSessionHistory, PiChatSessionSummary, PiChatMessage } from '../common/pi-chat-types.js';
import { PiChatContextUsage } from '../common/pi-chat-context-usage-types.js';
import { PiChatQueuedPrompt, PiChatRunEvent, PiChatRunSnapshot } from '../common/pi-chat-run-types.js';
import { PiChatInputCacheService } from './PiChatInputCacheService.js';
import { IPiChatOpenAILimitsService } from './PiChatOpenAILimitsService.js';
import { IPiChatSelectionService } from './PiChatSelectionService.js';
import { renderPiChatMessages } from './body/PiChatConversationBody.js';
import { PiChatListenPlayback } from './body/PiChatListenPlayback.js';
import { PiChatBodyScroll } from './body/PiChatBodyScroll.js';
import { PiChatMessageCopy } from './body/PiChatMessageCopy.js';
import { PiChatSessionLoadService } from './PiChatSessionLoadService.js';
import { PiChatModelService } from './PiChatModelService.js';
import { PiChatFooterControls, renderPiChatFooter } from './footer/PiChatConversationFooter.js';
import { renderPiChatHeader } from './header/PiChatConversationHeader.js';
import './media/piChat.css';

/** Smart conversation shared by the secondary view and editor tabs. */
export class PiChatConversationPane extends Disposable {
	readonly element: HTMLElement;
	private readonly header: HTMLElement;
	private readonly body: HTMLElement;
	private readonly bodyScroll: PiChatBodyScroll;
	private readonly footer: HTMLElement;
	private readonly renderedMessages = this._register(new MutableDisposable<DisposableStore>());
	private readonly playback = this._register(new MutableDisposable<PiChatListenPlayback>());
	private readonly loader: PiChatSessionLoadService;
	private readonly commands: ICommandService;
	private readonly selection: IPiChatSelectionService;
	private readonly inputCache: PiChatInputCacheService;
	private readonly limitClock = this._register(new IntervalTimer());
	private readonly copy: PiChatMessageCopy;
	private queued: PiChatQueuedPrompt[] = [];
	private readonly footerControls = this._register(new MutableDisposable<PiChatFooterControls>());
	private sending = false;
	private readonly modelsForSession = new Map<string, string>();
	private models: string[] = [];
	private defaultModel: string | undefined;
	private requestId = 0;
	private history: PiChatSessionHistory | undefined;
	private summary: PiChatSessionSummary | undefined;
	private messageCount = 120;
	private renderPending = false;

	constructor(parent: HTMLElement, @IInstantiationService instantiationService: IInstantiationService, @IMarkdownRendererService private readonly markdown: IMarkdownRendererService, @IClipboardService clipboardService: IClipboardService, @IPiChatOpenAILimitsService private readonly openAILimits: IPiChatOpenAILimitsService) {
		super();
		this.loader = instantiationService.createInstance(PiChatSessionLoadService);
		this.commands = instantiationService.invokeFunction(accessor => accessor.get(ICommandService));
		this.selection = instantiationService.invokeFunction(accessor => accessor.get(IPiChatSelectionService));
		this.inputCache = instantiationService.createInstance(PiChatInputCacheService);
		this.copy = new PiChatMessageCopy(text => clipboardService.writeText(text));
		this._register(this.selection.onDidSelectSession(session => {
			if (session.id === this.summary?.id && !this.sending && !session.isDraft) { void this.show(session); }
		}));
		void instantiationService.createInstance(PiChatModelService).loadModels().then(({ defaultModel, models }) => {
			if (this._store.isDisposed) { return; }
			this.defaultModel = defaultModel;
			this.models = models;
			this.renderFooter();
		});
		this.element = append(parent, $('.pi-chat-conversation'));
		this.header = append(this.element, $('header.pi-chat-conversation-header'));
		this._register(openAILimits.onDidChange(() => renderPiChatHeader(this.header, this.summary, this.history, openAILimits)));
		this.limitClock.cancelAndSet(() => {
			if (this.summary) { renderPiChatHeader(this.header, this.summary, this.history, openAILimits); void openAILimits.load(); }
		}, 60_000);
		const bodyShell = append(this.element, $('.pi-chat-conversation-body-shell'));
		this.body = append(bodyShell, $('.pi-chat-conversation-body', { 'aria-live': 'polite' }));
		this.bodyScroll = this._register(new PiChatBodyScroll(bodyShell, this.body));
		this._register(addDisposableListener(getWindow(this.body).document, 'selectionchange', () => {
			if (this.renderPending && !this.hasSelectedText()) { this.renderPending = false; this.render(); }
		}));
		this.footer = append(this.element, $('footer.pi-chat-conversation-footer'));
		this.renderFooter();
		this.render();
	}

	async show(summary: PiChatSessionSummary): Promise<void> {
		if (summary.id === this.summary?.id && (this.sending || (summary === this.summary && this.history))) { return; }
		if (summary.id !== this.summary?.id) { this.sending = false; this.bodyScroll.reset(); }
		this.summary = summary;
		void this.openAILimits.load();
		this.history = undefined;
		renderPiChatHeader(this.header, this.summary, this.history, this.openAILimits);
		this.queued = [];
		this.messageCount = 120;
		const request = ++this.requestId;
		this.body.textContent = summary.isDraft ? '' : localize('piChat.loadingConversation', "Loading conversation...");
		this.renderFooter();
		this.render();
		try {
			const history = await this.loader.loadSession(summary);
			if (request !== this.requestId || this._store.isDisposed) { return; }
			this.history = history;
			renderPiChatHeader(this.header, this.summary, this.history, this.openAILimits);
			void this.loadContextUsage(summary, request, history);
			const snapshot = await this.commands.executeCommand<PiChatRunSnapshot>('piChat.pollTurn', summary.id, 0);
			if (request !== this.requestId || this._store.isDisposed) { return; }
			this.queued = snapshot?.queued ?? [];
			if (!snapshot?.running) {
				const unsent = this.inputCache.getQueued(summary.id);
				if (unsent.length) {
					this.footerControls.value?.restore(unsent.map(item => item.text).join('\n\n'));
					this.inputCache.setQueued(summary.id, []);
				}
			} else {
				this.sending = true;
				this.footerControls.value?.setBusy(true);
				void this.watchRun(summary, request);
			}
			this.render();
		} catch {
			if (request === this.requestId) { this.body.textContent = localize('piChat.openError', "Could not open this conversation. Try selecting it again."); }
		}
	}

	private async loadContextUsage(summary: PiChatSessionSummary, request: number, history: PiChatSessionHistory): Promise<void> {
		if (summary.isDraft) { return; }
		try {
			const usage = await this.commands.executeCommand<PiChatContextUsage | undefined>('piChat.contextUsage', summary.id, summary.sessionFile.fsPath, summary.repoPath);
			if (request === this.requestId && this.history === history && !this._store.isDisposed) {
				history.contextUsage = usage;
				renderPiChatHeader(this.header, this.summary, history, this.openAILimits);
			}
		} catch { /* A missing or unreadable model leaves context unknown; conversation stays available. */ }
	}

	private renderFooter(): void {
		const summary = this.summary;
		const savedModel = this.history?.modelName;
		const model = (summary && this.modelsForSession.get(summary.id)) || (savedModel && savedModel !== 'Unknown model' ? savedModel : this.defaultModel);
		this.footerControls.value = renderPiChatFooter(this.footer, summary, model, this.models, this.inputCache, value => {
			if (this.summary) { this.modelsForSession.set(this.summary.id, value); }
			else { this.defaultModel = value; }
		}, text => this.send(text), async () => {
			if (!summary) { return; }
			const unsent = await this.commands.executeCommand<PiChatQueuedPrompt[]>('piChat.stopTurn', summary.id);
			if (unsent?.length && this.summary?.id === summary.id) {
				this.footerControls.value?.restore(unsent.map(item => item.text).join('\n\n'));
				this.queued = [];
				this.inputCache.setQueued(summary.id, []);
				this.render();
			}
		});
		this.footerControls.value.setBusy(this.sending);
	}

	private hasSelectedText(): boolean {
		const selection = getWindow(this.body).getSelection();
		return !!selection && !selection.isCollapsed && !!selection.anchorNode && this.body.contains(selection.anchorNode);
	}

	private render(scrollToLatest = true): void {
		// Streaming replaces message nodes; keep an active drag-selection intact until it is cleared.
		if (this.hasSelectedText()) { this.renderPending = true; return; }
		this.renderPending = false;
		const follow = scrollToLatest && this.bodyScroll.shouldFollow;
		const previousTop = this.body.scrollTop;
		this.playback.clear();
		this.renderedMessages.clear();
		if (!this.summary) {
			clearNode(this.body);
			const empty = append(this.body, $('.pi-chat-empty'));
			append(empty, $('h1', {}, 'Choose a conversation.'));
			append(empty, $('p', {}, 'Your recent Pi sessions are on the left.'));
		} else if (this.history) {
			this.renderedMessages.value = renderPiChatMessages(this.body, this.history, this.messageCount, () => {
				const previousHeight = this.body.scrollHeight;
				const previousTop = this.body.scrollTop;
				this.messageCount += 120;
				this.render(false);
				getWindow(this.body).requestAnimationFrame(() => {
					this.body.scrollTop = previousTop + this.body.scrollHeight - previousHeight;
				});
			}, (text, button, response) => {
				if (this.playback.value?.button === button) { this.playback.value.onClick(); }
				else { this.playback.value = new PiChatListenPlayback(button, response, this.commands, text); }
			}, this.markdown, this.copy, this.queued, id => { void this.cancelQueued(id); }, id => { void this.sendQueuedNow(id); });
		}
		this.bodyScroll.afterRender(follow, previousTop);
	}

	private async send(text: string): Promise<void> {
		const summary = this.summary;
		if (!summary) { return; }
		const request = this.requestId;
		if (this.sending) {
			const queued = await this.commands.executeCommand<PiChatQueuedPrompt[]>('piChat.queuePrompt', summary.id, generateUuid(), text);
			if (request === this.requestId && queued) { this.queued = queued; this.inputCache.setQueued(summary.id, queued); this.render(); }
			return;
		}
		this.sending = true;
		this.footerControls.value?.setBusy(true);
		try {
			if (!this.history) { this.history = await this.loader.loadSession(summary); }
			if (request !== this.requestId || this._store.isDisposed) { return; }
			const modelName = this.modelsForSession.get(summary.id) ?? (this.history?.modelName !== 'Unknown model' ? this.history?.modelName : this.defaultModel);
			await this.commands.executeCommand('piChat.startTurn', summary.id, summary.sessionFile.fsPath, summary.repoPath, text, modelName || undefined);
			if (request !== this.requestId || this._store.isDisposed) { return; }
			this.history?.messages.push({ id: `live-user-${Date.now()}`, role: 'user', content: text });
			this.render();
			void this.watchRun(summary, request);
		} catch (error) {
			if (request === this.requestId && !this._store.isDisposed) {
				this.sending = false;
				this.footerControls.value?.setBusy(false);
				this.showRunError(error);
			}
			throw error;
		}
	}

	private async watchRun(summary: PiChatSessionSummary, request: number): Promise<void> {
		let index = 0;
		try {
			while (request === this.requestId && !this._store.isDisposed) {
				const snapshot = await this.commands.executeCommand<PiChatRunSnapshot>('piChat.pollTurn', summary.id, index);
				if (request !== this.requestId || this._store.isDisposed) { return; }
				if (!snapshot) { throw new Error(localize('piChat.runtimeUnavailable', "Pi runtime is unavailable.")); }
				index = snapshot.nextIndex;
				for (const event of snapshot.events) { this.applyEvent(this.history!.messages, event); }
				const changedQueue = this.queued.map(item => item.id).join(',') !== snapshot.queued.map(item => item.id).join(',');
				if (!snapshot.running && !snapshot.events.some(event => event.type === 'complete') && this.queued.length) {
					this.footerControls.value?.restore(this.queued.map(item => item.text).join('\n\n'));
				}
				this.queued = snapshot.queued;
				if (changedQueue) { this.inputCache.setQueued(summary.id, this.queued); }
				if (snapshot.events.length) { this.footerControls.value?.recordEvent(); }
				if (changedQueue || snapshot.events.some(event => event.type === 'delta' || event.type === 'tool' || event.type === 'queuedSent')) { this.render(); }
				const error = snapshot.events.find(event => event.type === 'error');
				if (error?.type === 'error') { throw new Error(error.message); }
				if (snapshot.events.some(event => event.type === 'complete')) {
					const updated: PiChatSessionSummary = { ...summary, sessionFile: URI.file(summary.sessionFile.fsPath), isDraft: false, lastMessageAt: new Date().toISOString() };
					this.summary = updated;
					this.history = await this.loader.loadSession(updated);
					if (request !== this.requestId || this._store.isDisposed) { return; }
					renderPiChatHeader(this.header, this.summary, this.history, this.openAILimits);
					void this.loadContextUsage(updated, request, this.history);
					this.inputCache.setQueued(summary.id, []);
					this.sending = false;
					this.footerControls.value?.setBusy(false);
					this.render();
					this.selection.selectSession(updated);
					void this.openAILimits.refresh();
					return;
				}
				if (!snapshot.running) { throw new Error(localize('piChat.turnInterrupted', "Pi turn ended without a response. Try again.")); }
				await new Promise<void>(resolve => getWindow(this.body).setTimeout(resolve, 120));
			}
		} catch (error) {
			if (request === this.requestId && !this._store.isDisposed) { this.showRunError(error); void this.openAILimits.refresh(); }
		} finally {
			if (request === this.requestId && !this._store.isDisposed) { this.sending = false; this.footerControls.value?.setBusy(false); }
		}
	}

	private showRunError(error: unknown): void {
		this.history?.messages.push({ id: `live-error-${Date.now()}`, role: 'assistant', kind: 'notice', noticeType: 'warning', content: error instanceof Error ? error.message : localize('piChat.sendError', "Could not send this message.") });
		this.render();
	}

	private async cancelQueued(id: string): Promise<void> {
		if (!this.summary) { return; }
		try {
			const prompt = await this.commands.executeCommand<PiChatQueuedPrompt>('piChat.cancelPrompt', this.summary.id, id);
			if (prompt) { this.queued = this.queued.filter(item => item.id !== id); this.inputCache.setQueued(this.summary.id, this.queued); this.footerControls.value?.restore(prompt.text); this.render(); }
		} catch (error) { this.showRunError(error); }
	}

	private async sendQueuedNow(id: string): Promise<void> {
		if (!this.summary) { return; }
		try { await this.commands.executeCommand('piChat.sendPromptNow', this.summary.id, id); }
		catch (error) { this.showRunError(error); }
	}

	private applyEvent(messages: PiChatMessage[], event: PiChatRunEvent): void {
		if (event.type === 'delta') {
			const existing = messages.find(message => message.id === event.id);
			if (existing?.role === 'assistant' && (existing.kind === 'text' || existing.kind === 'thinking')) { messages[messages.indexOf(existing)] = { ...existing, content: existing.content + event.delta }; }
			else { messages.push({ id: event.id, role: 'assistant', kind: event.kind, content: event.delta }); }
		} else if (event.type === 'tool') {
			const index = messages.findIndex(message => message.id === event.message.id);
			if (index < 0) { messages.push(event.message); }
			else { messages[index] = event.message; }
		} else if (event.type === 'queuedSent' && !messages.some(message => message.id === event.prompt.id)) {
			messages.push({ id: event.prompt.id, role: 'user', content: event.prompt.text });
		}
	}
}
