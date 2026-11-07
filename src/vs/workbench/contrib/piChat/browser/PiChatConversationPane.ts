/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, getWindow } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IMarkdownRendererService } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { PiChatSessionHistory, PiChatSessionSummary } from '../common/pi-chat-types.js';
import { renderPiChatMessages } from './body/PiChatConversationBody.js';
import { PiChatListenPlayback } from './body/PiChatListenPlayback.js';
import { PiChatSessionLoadService } from './PiChatSessionLoadService.js';
import { PiChatModelService } from './PiChatModelService.js';
import { renderPiChatFooter } from './footer/PiChatConversationFooter.js';
import { renderPiChatHeader } from './header/PiChatConversationHeader.js';
import './media/piChat.css';

/** Smart read-only conversation shared by the secondary view and editor tabs. */
export class PiChatConversationPane extends Disposable {
	readonly element: HTMLElement;
	private readonly header: HTMLElement;
	private readonly body: HTMLElement;
	private readonly footer: HTMLElement;
	private readonly renderedMessages = this._register(new MutableDisposable<DisposableStore>());
	private readonly playback = this._register(new MutableDisposable<PiChatListenPlayback>());
	private readonly loader: PiChatSessionLoadService;
	private readonly commands: ICommandService;
	private readonly modelsForSession = new Map<string, string>();
	private models: string[] = [];
	private defaultModel: string | undefined;
	private requestId = 0;
	private history: PiChatSessionHistory | undefined;
	private summary: PiChatSessionSummary | undefined;
	private messageCount = 120;

	constructor(parent: HTMLElement, instantiationService: IInstantiationService, private readonly markdown: IMarkdownRendererService) {
		super();
		this.loader = instantiationService.createInstance(PiChatSessionLoadService);
		this.commands = instantiationService.invokeFunction(accessor => accessor.get(ICommandService));
		void instantiationService.createInstance(PiChatModelService).loadModels().then(({ defaultModel, models }) => {
			if (this._store.isDisposed) { return; }
			this.defaultModel = defaultModel;
			this.models = models;
			this.renderFooter();
		});
		this.element = append(parent, $('.pi-chat-conversation'));
		this.header = append(this.element, $('header.pi-chat-conversation-header'));
		this.body = append(this.element, $('.pi-chat-conversation-body', { 'aria-live': 'polite' }));
		this.footer = append(this.element, $('footer.pi-chat-conversation-footer'));
		this.render();
	}

	async show(summary: PiChatSessionSummary): Promise<void> {
		this.summary = summary;
		this.history = undefined;
		this.messageCount = 120;
		const request = ++this.requestId;
		this.body.textContent = summary.isDraft ? '' : 'Loading conversation...';
		this.render();
		try {
			const history = await this.loader.loadSession(summary);
			if (request !== this.requestId || this._store.isDisposed) { return; }
			this.history = history;
			this.render();
		} catch {
			if (request === this.requestId) { this.body.textContent = 'Could not open this conversation. Try selecting it again.'; }
		}
	}

	private renderFooter(): void {
		const summary = this.summary;
		const savedModel = this.history?.modelName;
		const model = (summary && this.modelsForSession.get(summary.id)) || (savedModel && savedModel !== 'Unknown model' ? savedModel : this.defaultModel);
		renderPiChatFooter(this.footer, summary, model, this.models, value => {
			if (this.summary) { this.modelsForSession.set(this.summary.id, value); }
			else { this.defaultModel = value; }
		});
	}

	private render(scrollToLatest = true): void {
		renderPiChatHeader(this.header, this.summary, this.history);
		this.renderFooter();
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
			}, this.markdown, scrollToLatest);
		}
	}
}
