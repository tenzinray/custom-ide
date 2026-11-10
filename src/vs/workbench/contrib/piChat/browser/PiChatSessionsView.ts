/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, getWindow } from '../../../../base/browser/dom.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IEditorService, SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { PiChatSessionSummary } from '../common/pi-chat-types.js';
import { PiChatCreatedSession } from '../common/pi-chat-run-types.js';
import { PiChatConversationView } from './PiChatConversationView.js';
import { PiChatSessionEditorInput } from './PiChatSessionEditorInput.js';
import { PiChatSessionListService } from './PiChatSessionListService.js';
import { PiChatInputCacheService } from './PiChatInputCacheService.js';
import { IPiChatSelectionService } from './PiChatSelectionService.js';
import { PiChatRepoPicker } from './sidebar/PiChatRepoPicker.js';
import { renderPiChatSessionList } from './sidebar/PiChatSessionList.js';
import './media/piChat.css';

/** Pi UI session list; selection shows the conversation on the right, split opens an editor tab. */
export class PiChatSessionsView extends ViewPane {
	static readonly ID = 'workbench.view.piChatSessions';
	private list: HTMLElement | undefined;
	private shell: HTMLElement | undefined;
	private sessions: PiChatSessionSummary[] = [];
	private pinnedSessions: PiChatSessionSummary[] = [];
	private hasMore = false;
	private draft: PiChatSessionSummary | undefined;
	private limit = PiChatSessionListService.initialLimit;
	private refreshId = 0;
	private readonly picker = this._register(new MutableDisposable<PiChatRepoPicker>());
	private readonly sessionListService: PiChatSessionListService;
	private readonly inputCache: PiChatInputCacheService;

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService private readonly piInstantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IEditorService private readonly editorService: IEditorService,
		@IViewsService private readonly viewsService: IViewsService,
		@IPiChatSelectionService private readonly selection: IPiChatSelectionService,
		@IFileService private readonly fileService: IFileService,
		@ICommandService private readonly commands: ICommandService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, piInstantiationService, openerService, themeService, hoverService);
		this.sessionListService = piInstantiationService.createInstance(PiChatSessionListService);
		this.inputCache = piInstantiationService.createInstance(PiChatInputCacheService);
		this._register(this.onDidChangeBodyVisibility(visible => { if (visible) { void this.refresh(); } }));
		this._register(selection.onDidSelectSession(session => {
			if (!session) { this.renderSessions(); return; }
			if (session.isDraft) { this.draft = session; }
			if (!session.isDraft && (this.draft?.id === session.id || [...this.sessions, ...this.pinnedSessions].some(saved => saved.id === session.id && saved.lastMessageAt !== session.lastMessageAt))) {
				this.draft = undefined;
				this.inputCache.setDraftSession(undefined);
				this.sessionListService.invalidate();
				void this.refresh();
			} else { this.renderSessions(); }
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		const targetWindow = getWindow(container);
		const timer = targetWindow.setInterval(() => this.renderSessions(), 60_000);
		this._register(toDisposable(() => targetWindow.clearInterval(timer)));
		const shell = this.shell = append(container, $('.pi-chat-sidebar'));
		const create = append(shell, $('button.pi-chat-new-chat'));
		append(create, $('span.codicon.codicon-add', { 'aria-hidden': 'true' }));
		append(create, $('span', {}, 'New chat'));
		create.addEventListener('click', () => this.openRepoPicker());
		this.list = append(shell, $('nav.pi-chat-sessions', { 'aria-label': localize('piChat.conversations', "Conversations") }));
		const bottom = append(shell, $('.pi-chat-sidebar-bottom'));
		const settings = append(bottom, $('button.pi-chat-sidebar-settings', { disabled: 'true', title: 'Settings is not available yet' }));
		append(settings, $('span.codicon.codicon-settings-gear', { 'aria-hidden': 'true' }));
		append(settings, $('span', {}, 'Settings'));
		void this.restoreDraft();
		void this.refresh();
	}

	private openRepoPicker(): void {
		if (!this.shell) { return; }
		this.picker.value = this.piInstantiationService.createInstance(PiChatRepoPicker, this.shell, () => this.picker.clear());
	}

	private async restoreDraft(): Promise<void> {
		const saved = this.inputCache.getDraftSession();
		if (!saved) { return; }
		if (await this.fileService.exists(saved.sessionFile)) { this.inputCache.setDraftSession(undefined); return; }
		this.draft = saved;
		this.renderSessions();
		try {
			const created = await this.commands.executeCommand<PiChatCreatedSession>('piChat.restoreDraft', saved.id, saved.repoPath);
			if (!created || this._store.isDisposed || this.draft?.id !== saved.id) { return; }
			this.draft = { ...saved, sessionFile: URI.file(created.sessionFile) };
			this.inputCache.setDraftSession(this.draft);
			if (this.selection.selectedSession?.id === saved.id) { this.selection.selectSession(this.draft); }
			this.renderSessions();
		} catch (error) { this.notificationService.error(error); }
	}

	private async refresh(): Promise<void> {
		if (!this.list) { return; }
		const requestId = ++this.refreshId;
		if (!this.sessions.length && !this.pinnedSessions.length && !this.draft) { this.list.textContent = localize('piChat.loading', "Loading conversations..."); }
		try {
			const [{ sessions, hasMore }, pinned] = await Promise.all([
				this.sessionListService.listSessions(this.limit),
				Promise.all([...this.sessionListService.getPinnedIds()].map(id => id === this.draft?.id ? this.draft : this.sessionListService.findSession(id))),
			]);
			if (requestId !== this.refreshId || this._store.isDisposed) { return; }
			this.sessions = sessions;
			this.pinnedSessions = pinned.filter(session => session !== undefined);
			this.hasMore = hasMore;
			this.renderSessions();
		} catch {
			if (requestId === this.refreshId) { this.list.textContent = localize('piChat.loadError', "Could not load Pi conversations."); }
		}
	}

	private renderSessions(): void {
		if (!this.list) { return; }
		const sessions = [...this.pinnedSessions, ...this.sessions].filter(session => session.id !== this.draft?.id);
		renderPiChatSessionList(this.list, this.draft ? [this.draft, ...sessions] : sessions, this.sessionListService.getPinnedIds(), this.hasMore, this.selection.selectedSession?.id, this.piInstantiationService,
			session => { this.selection.selectSession(session); void this.viewsService.openView(PiChatConversationView.ID, true); },
			session => this.openInEditor(session),
			() => { this.limit += PiChatSessionListService.pageSize; void this.refresh(); },
			session => {
				this.sessionListService.setPinned(session.id, !this.sessionListService.getPinnedIds().has(session.id));
				void this.refresh();
			});
	}

	private openInEditor(session: PiChatSessionSummary): void {
		const existing = this.editorService.findEditors(PiChatSessionEditorInput.resourceForSession(session.id))[0];
		const input = existing?.editor ?? new PiChatSessionEditorInput(session);
		void this.editorService.openEditor(input, { pinned: true }, existing?.groupId ?? SIDE_GROUP).then(pane => {
			if (input !== pane?.input && !existing) { input.dispose(); }
		}, error => {
			if (!existing) { input.dispose(); }
			onUnexpectedError(error);
		});
	}
}
