/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow } from '../../../../base/browser/dom.js';
import { Event } from '../../../../base/common/event.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
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
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { isPiChatSessionTab } from '../common/pi-chat-tab-types.js';
import { PiChatSessionSummary } from '../common/pi-chat-types.js';
import { PiChatCreatedSession } from '../common/pi-chat-run-types.js';
import { PiChatConversationView } from './PiChatConversationView.js';
import { PiChatSessionListService } from './PiChatSessionListService.js';
import { PiChatSessionRenameService } from './PiChatSessionRenameService.js';
import { PiChatInputCacheService } from './PiChatInputCacheService.js';
import { IPiChatSelectionService } from './PiChatSelectionService.js';
import { Direction } from '../../../../base/browser/ui/grid/grid.js';
import { renderPiChatSessionList } from './sidebar/PiChatSessionList.js';
import './media/piChat.css';

/** Session list; selection opens a secondary tab, explicit split opens a secondary group. */
export class PiChatSessionsView extends ViewPane {
	static readonly ID = 'workbench.view.piChatSessions';
	private list: HTMLElement | undefined;
	private sessions: PiChatSessionSummary[] = [];
	private pinnedSessions: PiChatSessionSummary[] = [];
	private hasMore = false;
	private draft: PiChatSessionSummary | undefined;
	private limit = PiChatSessionListService.initialLimit;
	private refreshId = 0;
	private readonly sessionListService: PiChatSessionListService;
	private readonly inputCache: PiChatInputCacheService;
	private readonly rename: PiChatSessionRenameService;

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
		@IViewsService private readonly viewsService: IViewsService,
		@IPiChatSelectionService private readonly selection: IPiChatSelectionService,
		@IFileService private readonly fileService: IFileService,
		@ICommandService private readonly commands: ICommandService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, piInstantiationService, openerService, themeService, hoverService);
		this.sessionListService = piInstantiationService.createInstance(PiChatSessionListService);
		this.inputCache = piInstantiationService.createInstance(PiChatInputCacheService);
		this.rename = this._register(piInstantiationService.createInstance(PiChatSessionRenameService));
		this.sessionListService.onDidChangePins(this._store, () => { void this.refresh(); });
		this.sessionListService.onDidChangeSummaries(this._store, () => { void this.refresh(); });
		this._register(this.onDidChangeBodyVisibility(visible => { if (visible) { void this.refresh(); } }));
		this._register(Event.any(selection.onDidSelectSession, selection.onDidUpdateSession)(session => {
			if (!session) { this.renderSessions(); return; }
			const changedTimestamp = [...this.sessions, ...this.pinnedSessions].some(saved => saved.id === session.id && saved.lastMessageAt !== session.lastMessageAt);
			this.sessions = this.sessions.map(saved => saved.id === session.id ? session : saved);
			this.pinnedSessions = this.pinnedSessions.map(saved => saved.id === session.id ? session : saved);
			if (session.isDraft) { this.draft = session; }
			this.sessionListService.invalidate();
			if (!session.isDraft && (this.draft?.id === session.id || changedTimestamp)) {
				if (this.draft?.id === session.id) { this.draft = undefined; }
				if (this.inputCache.getDraftSession()?.id === session.id) { this.inputCache.setDraftSession(undefined); }
				void this.refresh();
			} else { this.renderSessions(); }
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		const targetWindow = getWindow(container);
		const timer = targetWindow.setInterval(() => this.renderSessions(), 60_000);
		this._register(toDisposable(() => targetWindow.clearInterval(timer)));
		const shell = append(container, $('.pi-chat-sidebar'));
		const newActions = append(shell, $('.pi-chat-new-actions'));
		const create = append(newActions, $('button.pi-chat-new-chat'));
		append(create, $('span.codicon.codicon-add', { 'aria-hidden': 'true' }));
		append(create, $('span', {}, localize('piChat.newChat', "New Chat")));
		this._register(addDisposableListener(create, 'click', () => { void this.commands.executeCommand('piChat.newChat'); }));
		const split = append(newActions, $('button.pi-chat-new-split.codicon.codicon-split-horizontal', { type: 'button', 'aria-label': localize('piChat.newSplit', "New Chat in Split View") }));
		this._register(addDisposableListener(split, 'click', () => { void this.commands.executeCommand('piChat.newChat', undefined, true); }));
		this.list = append(shell, $('nav.pi-chat-sessions', { 'aria-label': localize('piChat.conversations', "Conversations") }));
		const bottom = append(shell, $('.pi-chat-sidebar-bottom'));
		const settings = append(bottom, $('button.pi-chat-sidebar-settings', { disabled: 'true', title: 'Settings is not available yet' }));
		append(settings, $('span.codicon.codicon-settings-gear', { 'aria-hidden': 'true' }));
		append(settings, $('span', {}, 'Settings'));
		void this.restoreDraft();
		void this.refresh();
	}

	private async restoreDraft(): Promise<void> {
		const saved = this.inputCache.getDraftSession();
		if (!saved) { return; }
		if (await this.fileService.exists(saved.sessionFile)) { this.inputCache.setDraftSession(undefined); return; }
		this.draft = saved;
		this.renderSessions();
		try {
			const created = await this.commands.executeCommand<PiChatCreatedSession>('piChat.restoreDraft', saved.id, saved.repoPath, saved.sessionName);
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
		if (!this.list || this.rename.isEditing) { return; }
		const openSessions = this.selection.groups.flatMap(group => group.tabs).filter(isPiChatSessionTab);
		const drafts = [...new Map(openSessions.filter(session => session.isDraft).map(session => [session.id, session])).values()];
		if (this.draft && !openSessions.some(session => session.id === this.draft?.id)) { drafts.push(this.draft); }
		const draftIds = new Set(drafts.map(session => session.id));
		const sessions = [...this.pinnedSessions, ...this.sessions].filter(session => !draftIds.has(session.id));
		renderPiChatSessionList(this.list, [...drafts, ...sessions], this.sessionListService.getPinnedIds(), this.hasMore, this.selection.selectedSession?.id, this.piInstantiationService,
			session => { this.selection.selectSession(session); void this.viewsService.openView(PiChatConversationView.ID, true); },
			session => { this.selection.selectSession(session, { direction: Direction.Right }); void this.viewsService.openView(PiChatConversationView.ID, true); },
			() => { this.limit += PiChatSessionListService.pageSize; void this.refresh(); },
			session => {
				this.sessionListService.setPinned(session.id, !this.sessionListService.getPinnedIds().has(session.id));
			}, (session, label) => this.rename.begin(session, label, () => this.renderSessions()));
	}

}
