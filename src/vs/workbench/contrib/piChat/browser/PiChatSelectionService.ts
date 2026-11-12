/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Direction } from '../../../../base/browser/ui/grid/grid.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { isPiChatSessionTab, PiChatTab } from '../common/pi-chat-tab-types.js';
import { PiChatSessionSummary } from '../common/pi-chat-types.js';

export interface PiChatSessionOpenOptions {
	readonly groupId?: number;
	readonly direction?: Direction.Left | Direction.Right;
	readonly replaceTabId?: string;
}

export interface PiChatGroup {
	readonly id: number;
	readonly tabs: readonly PiChatTab[];
	readonly activeSessionId: string | undefined;
	readonly referenceGroupId?: number;
	readonly direction?: PiChatSessionOpenOptions['direction'];
}

export const IPiChatSelectionService = createDecorator<IPiChatSelectionService>('piChatSelectionService');

export interface IPiChatSelectionService {
	readonly _serviceBrand: undefined;
	readonly onDidSelectSession: Event<PiChatSessionSummary | undefined>;
	readonly onDidChangeGroups: Event<void>;
	readonly onDidUpdateSession: Event<PiChatSessionSummary>;
	readonly selectedSession: PiChatSessionSummary | undefined;
	readonly groups: readonly PiChatGroup[];
	readonly activeGroupId: number;
	selectSession(session: PiChatSessionSummary, options?: PiChatSessionOpenOptions): void;
	openNewChat(options?: PiChatSessionOpenOptions): void;
	activateTab(groupId: number, tabId: string): void;
	updateSession(session: PiChatSessionSummary): void;
	activateGroup(groupId: number): void;
	closeSession(groupId: number, sessionId: string): void;
	moveTab(tab: PiChatTab, sourceGroupId: number | undefined, options: PiChatSessionOpenOptions): void;
	clearSelection(): void;
}

/** Canonical tab/group state shared by the session list and secondary conversation container. */
export class PiChatSelectionService extends Disposable implements IPiChatSelectionService {
	declare readonly _serviceBrand: undefined;
	private readonly selection = this._register(new Emitter<PiChatSessionSummary | undefined>());
	readonly onDidSelectSession = this.selection.event;
	private readonly groupsChanged = this._register(new Emitter<void>());
	readonly onDidChangeGroups = this.groupsChanged.event;
	private readonly sessionUpdated = this._register(new Emitter<PiChatSessionSummary>());
	readonly onDidUpdateSession = this.sessionUpdated.event;
	private nextGroupId = 1;
	groups: PiChatGroup[] = [{ id: 0, tabs: [], activeSessionId: undefined }];
	activeGroupId = 0;

	get selectedSession(): PiChatSessionSummary | undefined {
		const group = this.groups.find(group => group.id === this.activeGroupId);
		const tab = group?.tabs.find(tab => tab.id === group.activeSessionId);
		return tab && isPiChatSessionTab(tab) ? tab : undefined;
	}

	clearSelection(): void {
		this.groups = this.groups.map(group => group.id === this.activeGroupId ? { ...group, activeSessionId: undefined } : group);
		this.changed();
	}

	openNewChat(options: PiChatSessionOpenOptions = {}): void {
		this.openTab({ id: generateUuid(), isNewChat: true }, options);
	}

	selectSession(session: PiChatSessionSummary, options: PiChatSessionOpenOptions = {}): void {
		this.replaceSession(session);
		this.openTab(session, options);
	}

	private openTab(tab: PiChatTab, options: PiChatSessionOpenOptions): void {
		let group = this.groups.find(group => group.id === (options.groupId ?? this.activeGroupId)) ?? this.groups.find(group => group.id === this.activeGroupId)!;
		if (options.direction !== undefined && group.tabs.length) {
			group = { id: this.nextGroupId++, tabs: [], activeSessionId: undefined, referenceGroupId: group.id, direction: options.direction };
			const referenceIndex = this.groups.findIndex(current => current.id === group.referenceGroupId);
			this.groups.splice(referenceIndex + (options.direction === Direction.Right ? 1 : 0), 0, group);
		} else if (options.groupId === undefined && options.direction === undefined && !options.replaceTabId) {
			group = group.tabs.some(current => current.id === tab.id) ? group : this.groups.find(group => group.tabs.some(current => current.id === tab.id)) ?? group;
		}
		this.activeGroupId = group.id;
		this.groups = this.groups.map(current => {
			if (current.id !== group.id) { return current; }
			const existing = current.tabs.some(current => current.id === tab.id);
			let tabs = current.tabs;
			if (options.replaceTabId && tabs.some(current => current.id === options.replaceTabId)) {
				tabs = existing ? tabs.filter(current => current.id !== options.replaceTabId) : tabs.map(current => current.id === options.replaceTabId ? tab : current);
			} else if (!existing) { tabs = [...tabs, tab]; }
			return { ...current, tabs, activeSessionId: tab.id };
		});
		this.changed();
	}

	activateTab(groupId: number, tabId: string): void {
		const group = this.groups.find(group => group.id === groupId);
		if (!group?.tabs.some(tab => tab.id === tabId)) { return; }
		this.activeGroupId = groupId;
		this.groups = this.groups.map(group => group.id === groupId ? { ...group, activeSessionId: tabId } : group);
		this.changed();
	}

	updateSession(session: PiChatSessionSummary): void {
		this.replaceSession(session);
		this.groupsChanged.fire();
		this.sessionUpdated.fire(session);
	}

	private replaceSession(session: PiChatSessionSummary): void {
		this.groups = this.groups.map(group => group.tabs.some(tab => tab.id === session.id && tab !== session)
			? { ...group, tabs: group.tabs.map(tab => tab.id === session.id ? session : tab) }
			: group);
	}

	activateGroup(groupId: number): void {
		if (groupId === this.activeGroupId || !this.groups.some(group => group.id === groupId)) { return; }
		this.activeGroupId = groupId;
		this.changed();
	}

	closeSession(groupId: number, sessionId: string): void {
		this.groups = this.groups.map(group => {
			if (group.id !== groupId) { return group; }
			const index = group.tabs.findIndex(tab => tab.id === sessionId);
			const tabs = group.tabs.filter(tab => tab.id !== sessionId);
			return { ...group, tabs, activeSessionId: group.activeSessionId === sessionId ? tabs[Math.max(0, index - 1)]?.id : group.activeSessionId };
		});
		this.removeEmptyGroups();
		this.changed();
	}

	moveTab(tab: PiChatTab, sourceGroupId: number | undefined, options: PiChatSessionOpenOptions): void {
		if (sourceGroupId !== undefined && sourceGroupId === options.groupId && options.direction === undefined) { this.activateTab(sourceGroupId, tab.id); return; }
		// Open first so moving the only tab cannot remove the reference group before splitting.
		this.openTab(tab, options);
		if (sourceGroupId !== undefined && sourceGroupId !== this.activeGroupId) { this.closeSession(sourceGroupId, tab.id); }
	}

	private removeEmptyGroups(): void {
		if (this.groups.length > 1) {
			const populated = this.groups.filter(group => group.tabs.length);
			this.groups = populated.length ? populated : [this.groups[0]];
		}
		if (!this.groups.some(group => group.id === this.activeGroupId)) { this.activeGroupId = this.groups[0].id; }
	}

	private changed(): void {
		this.groupsChanged.fire();
		this.selection.fire(this.selectedSession);
	}
}
