/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Direction } from '../../../../base/browser/ui/grid/grid.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { PiChatSessionSummary } from '../common/pi-chat-types.js';

export interface PiChatSessionOpenOptions {
	readonly groupId?: number;
	readonly direction?: Direction.Left | Direction.Right;
}

export interface PiChatGroup {
	readonly id: number;
	readonly sessions: readonly PiChatSessionSummary[];
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
	updateSession(session: PiChatSessionSummary): void;
	activateGroup(groupId: number): void;
	closeSession(groupId: number, sessionId: string): void;
	moveSession(session: PiChatSessionSummary, sourceGroupId: number | undefined, options: PiChatSessionOpenOptions): void;
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
	groups: PiChatGroup[] = [{ id: 0, sessions: [], activeSessionId: undefined }];
	activeGroupId = 0;

	get selectedSession(): PiChatSessionSummary | undefined {
		const group = this.groups.find(group => group.id === this.activeGroupId);
		return group?.sessions.find(session => session.id === group.activeSessionId);
	}

	clearSelection(): void {
		this.groups = this.groups.map(group => group.id === this.activeGroupId ? { ...group, activeSessionId: undefined } : group);
		this.changed();
	}

	selectSession(session: PiChatSessionSummary, options: PiChatSessionOpenOptions = {}): void {
		this.replaceSession(session);
		let group = this.groups.find(group => group.id === (options.groupId ?? this.activeGroupId)) ?? this.groups.find(group => group.id === this.activeGroupId)!;
		if (options.direction !== undefined && group.sessions.length) {
			group = { id: this.nextGroupId++, sessions: [], activeSessionId: undefined, referenceGroupId: group.id, direction: options.direction };
			const referenceIndex = this.groups.findIndex(current => current.id === group.referenceGroupId);
			this.groups.splice(referenceIndex + (options.direction === Direction.Right ? 1 : 0), 0, group);
		} else if (options.groupId === undefined && options.direction === undefined) {
			group = group.sessions.some(tab => tab.id === session.id) ? group : this.groups.find(group => group.sessions.some(tab => tab.id === session.id)) ?? group;
		}
		this.activeGroupId = group.id;
		this.groups = this.groups.map(current => current.id === group.id ? { ...current, sessions: current.sessions.some(tab => tab.id === session.id) ? current.sessions : [...current.sessions, session], activeSessionId: session.id } : current);
		this.changed();
	}

	updateSession(session: PiChatSessionSummary): void {
		this.replaceSession(session);
		this.groupsChanged.fire();
		this.sessionUpdated.fire(session);
	}

	private replaceSession(session: PiChatSessionSummary): void {
		this.groups = this.groups.map(group => group.sessions.some(tab => tab.id === session.id && tab !== session)
			? { ...group, sessions: group.sessions.map(tab => tab.id === session.id ? session : tab) }
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
			const index = group.sessions.findIndex(session => session.id === sessionId);
			const sessions = group.sessions.filter(session => session.id !== sessionId);
			return { ...group, sessions, activeSessionId: group.activeSessionId === sessionId ? sessions[Math.max(0, index - 1)]?.id : group.activeSessionId };
		});
		this.removeEmptyGroups();
		this.changed();
	}

	moveSession(session: PiChatSessionSummary, sourceGroupId: number | undefined, options: PiChatSessionOpenOptions): void {
		if (sourceGroupId === options.groupId && options.direction === undefined) { this.selectSession(session, options); return; }
		// Open first so moving the only tab cannot remove the reference group before splitting.
		this.selectSession(session, options);
		if (sourceGroupId !== undefined && sourceGroupId !== this.activeGroupId) {
			this.closeSession(sourceGroupId, session.id);
		}
	}

	private removeEmptyGroups(): void {
		if (this.groups.length > 1) {
			const populated = this.groups.filter(group => group.sessions.length);
			this.groups = populated.length ? populated : [this.groups[0]];
		}
		if (!this.groups.some(group => group.id === this.activeGroupId)) { this.activeGroupId = this.groups[0].id; }
	}

	private changed(): void {
		this.groupsChanged.fire();
		this.selection.fire(this.selectedSession);
	}
}
