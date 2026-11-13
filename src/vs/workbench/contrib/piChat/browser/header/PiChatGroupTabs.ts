/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { isPiChatSessionTab, PiChatTab } from '../../common/pi-chat-tab-types.js';
import { getPiChatSessionLabel } from '../../common/pi-chat-types.js';
import { PiChatGroup } from '../PiChatSelectionService.js';

/** One group's tab strip, shared by the unsplit part title and split-pane headers. */
export class PiChatGroupTabs extends Disposable {
	readonly element = $('.composite-bar-container.pi-chat-title-tabs');
	private readonly scroller: HTMLElement;
	private readonly tabs: HTMLElement;
	private readonly rendered = this._register(new DisposableStore());
	private activeTab: HTMLElement | undefined;

	constructor(private readonly onNew: () => void,
		private readonly onSelect: (tab: PiChatTab, groupId: number) => void,
		private readonly onClose: (tab: PiChatTab, groupId: number) => void,
		private readonly onDrag: (tab: PiChatTab, groupId: number, event: DragEvent) => void,
		private readonly onContextMenu: (tab: PiChatTab, label: HTMLElement, event: MouseEvent) => void,
		@IHoverService private readonly hover: IHoverService,
	) {
		super();
		const bar = append(this.element, $('.composite-bar'));
		this.scroller = append(bar, $('.monaco-action-bar'));
		this.tabs = append(this.scroller, $('ul.actions-container', { role: 'tablist', 'aria-label': localize('piChat.tabs', "Chat Tabs") }));
	}

	render(group: PiChatGroup): void {
		this.rendered.clear();
		this.activeTab = undefined;
		clearNode(this.tabs);
		const entries = group.tabs;
		for (const [index, session] of entries.entries()) {
			const active = session.id === group.activeSessionId;
			const tab = append(this.tabs, $('li.action-item.pi-chat-group-tab', { role: 'tab', tabindex: active ? '0' : '-1', 'aria-selected': String(active), draggable: 'true' }));
			tab.classList.toggle('checked', active);
			if (active) { this.activeTab = tab; }
			const label = isPiChatSessionTab(session) ? getPiChatSessionLabel(session) : localize('piChat.newChatTab', "New Chat");
			const hoverText = isPiChatSessionTab(session) ? `${session.repoPath}\n${session.isDraft ? localize('piChat.draftTab', "New Chat") : new Date(session.lastMessageAt).toLocaleString()}` : label;
			this.rendered.add(this.hover.setupDelayedHover(tab, { content: hoverText }));
			const duplicates = entries.filter(entry => isPiChatSessionTab(entry) && getPiChatSessionLabel(entry) === label).length;
			const name = append(tab, $('span.action-label.pi-chat-group-tab-label', {}, duplicates > 1 ? `${label} · ${index + 1}` : label));
			this.rendered.add(addDisposableListener(tab, 'contextmenu', event => {
				event.preventDefault();
				event.stopPropagation();
				this.onContextMenu(session, name, event);
			}));
			append(tab, $('span.active-item-indicator'));
			const close = append(tab, $('button.pi-chat-tab-close.codicon.codicon-close-compact', { type: 'button', tabindex: '-1', 'aria-label': localize('piChat.closeTab', "Close {0}", label) }));
			this.rendered.add(addDisposableListener(close, 'click', event => { event.stopPropagation(); this.onClose(session, group.id); }));
			this.rendered.add(addDisposableListener(tab, 'click', () => this.onSelect(session, group.id)));
			this.rendered.add(addDisposableListener(tab, 'auxclick', event => { if (event.button === 1) { event.preventDefault(); this.onClose(session, group.id); } }));
			this.rendered.add(addDisposableListener(tab, 'dragstart', event => { this.onDrag(session, group.id, event); event.stopPropagation(); }));
			this.rendered.add(addDisposableListener(tab, 'keydown', event => {
				if (event.key === 'Delete') { event.preventDefault(); this.onClose(session, group.id); }
				else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.onSelect(session, group.id); }
				else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
					event.preventDefault();
					const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + entries.length) % entries.length;
					this.onSelect(entries[next], group.id);
					(this.tabs.children[next] as HTMLElement | undefined)?.focus();
				}
			}));
		}
		const add = append(this.tabs, $('li.pi-chat-add-tab', { role: 'presentation' }));
		const label = localize('piChat.newTab', "New Chat Tab");
		const button = append(add, $('button.pi-chat-group-action.codicon.codicon-add', { type: 'button', 'aria-label': label }));
		this.rendered.add(addDisposableListener(button, 'click', this.onNew));
		this.rendered.add(this.hover.setupDelayedHover(button, { content: label }));
		this.revealActiveTab();
	}

	revealActiveTab(): void {
		const active = this.activeTab;
		if (!active) { return; }
		const left = active.offsetLeft - this.tabs.offsetLeft;
		if (left < this.scroller.scrollLeft) { this.scroller.scrollLeft = left; }
		else if (left + active.offsetWidth > this.scroller.scrollLeft + this.scroller.clientWidth) { this.scroller.scrollLeft = left + active.offsetWidth - this.scroller.clientWidth; }
	}
}
