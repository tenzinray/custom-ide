/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { IView } from '../../../../base/browser/ui/grid/grid.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, DisposableMap, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { isPiChatSessionTab } from '../common/pi-chat-tab-types.js';
import { PiChatConversationPane } from './PiChatConversationPane.js';
import { fillPiChatDragData, PiChatGroupDropTarget } from './PiChatGroupDropTarget.js';
import { IPiChatSelectionService, PiChatGroup, PiChatSessionOpenOptions } from './PiChatSelectionService.js';
import { PiChatSessionListService } from './PiChatSessionListService.js';
import { PiChatGroupTabs } from './header/PiChatGroupTabs.js';

/** A grid leaf owns its tab strip, retained conversations, and tab/body drop targets. */
export class PiChatConversationGroup extends Disposable implements IView {
	readonly element = $('.pi-chat-group.pane-composite-part');
	readonly minimumWidth = 220;
	readonly maximumWidth = Number.POSITIVE_INFINITY;
	readonly minimumHeight = 160;
	readonly maximumHeight = Number.POSITIVE_INFINITY;
	readonly onDidChange = Event.None;
	private readonly body: HTMLElement;
	private readonly title: HTMLElement;
	readonly tabs: PiChatGroupTabs;
	private readonly panes = this._register(new DisposableMap<string, PiChatConversationPane>());
	private readonly emptyPane = this._register(new MutableDisposable<PiChatConversationPane>());
	private state: PiChatGroup | undefined;
	private readonly sessions: PiChatSessionListService;
	private showOpenAILimits = false;

	constructor(readonly id: number, onNew: () => void,
		@IInstantiationService private readonly instantiation: IInstantiationService,
		@IPiChatSelectionService private readonly selection: IPiChatSelectionService,
		@INotificationService private readonly notifications: INotificationService,
	) {
		super();
		this.sessions = instantiation.createInstance(PiChatSessionListService);
		this.title = append(this.element, $('.title.has-composite-bar.pi-chat-group-title'));
		this.tabs = this._register(instantiation.createInstance(PiChatGroupTabs, onNew,
			(tab, groupId) => selection.activateTab(groupId, tab.id),
			(session, groupId) => selection.closeSession(groupId, session.id),
			(session, groupId, event) => fillPiChatDragData(instantiation, session, event, groupId)));
		this.title.appendChild(this.tabs.element);
		this.body = append(this.element, $('.pi-chat-group-body'));
		this._register(new PiChatGroupDropTarget(this.tabs.element, (sessionId, sourceGroupId) => {
			void this.drop(sessionId, sourceGroupId, undefined).catch(error => notifications.error(error));
		}, true));
		this._register(addDisposableListener(this.element, 'focusin', () => selection.activateGroup(id)));
		this._register(addDisposableListener(this.element, 'pointerdown', () => selection.activateGroup(id)));
		this._register(new PiChatGroupDropTarget(this.element, (sessionId, sourceGroupId, direction) => {
			void this.drop(sessionId, sourceGroupId, direction).catch(error => notifications.error(error));
		}));
	}

	private async drop(sessionId: string, sourceGroupId: number | undefined, direction: PiChatSessionOpenOptions['direction']): Promise<void> {
		const session = this.selection.groups.flatMap(group => group.tabs).find(session => session.id === sessionId) ?? await this.sessions.findSession(sessionId);
		if (!session || this._store.isDisposed) { return; }
		this.selection.moveTab(session, sourceGroupId, { groupId: this.id, direction });
	}

	/** An unsplit group lends its strip to the part title; split groups render their own headers. */
	showLocalTitle(local: boolean, globalActions?: HTMLElement): void {
		this.title.hidden = !local;
		if (local && this.tabs.element.parentElement !== this.title) { this.title.prepend(this.tabs.element); }
		if (globalActions && globalActions.parentElement !== this.title) { this.title.appendChild(globalActions); }
	}

	/** Session context stays per chat; account limits belong only to the rightmost visible chat. */
	setShowOpenAILimits(show: boolean): void {
		this.showOpenAILimits = show;
		for (const [id, pane] of this.panes) { pane.setShowOpenAILimits(show && id === this.state?.activeSessionId); }
	}

	update(group: PiChatGroup): void {
		this.element.classList.toggle('active-group', this.selection.activeGroupId === this.id);
		if (group === this.state) { return; }
		this.state = group;
		this.tabs.render(group);
		for (const [id, pane] of this.panes) {
			if (!group.tabs.some(tab => tab.id === id)) { pane.element.remove(); this.panes.deleteAndDispose(id); }
		}
		for (const session of group.tabs) {
			let pane = this.panes.get(session.id);
			if (!pane) {
				pane = this.instantiation.createInstance(PiChatConversationPane, this.body);
				this.panes.set(session.id, pane);
				if (isPiChatSessionTab(session)) { void pane.show(session).catch(error => this.notifications.error(error)); }
				else { pane.setSessionOpenOptions({ groupId: this.id, replaceTabId: session.id }); }
			}
			pane.setShowOpenAILimits(this.showOpenAILimits && session.id === group.activeSessionId);
			pane.element.hidden = session.id !== group.activeSessionId;
		}
		if (!group.activeSessionId && !this.emptyPane.value) {
			this.emptyPane.value = this.instantiation.createInstance(PiChatConversationPane, this.body);
			this.emptyPane.value.setSessionOpenOptions({ groupId: this.id });
		}
		if (this.emptyPane.value) { this.emptyPane.value.element.hidden = !!group.activeSessionId; }
	}

	insertFiles(resources: readonly URI[]): boolean {
		return this.state?.activeSessionId ? this.panes.get(this.state.activeSessionId)?.insertFiles(resources) ?? false : false;
	}

	layout(width: number, height: number): void {
		this.element.style.width = `${width}px`;
		this.element.style.height = `${height}px`;
		this.tabs.revealActiveTab();
	}

	override dispose(): void {
		this.element.remove();
		super.dispose();
	}
}
