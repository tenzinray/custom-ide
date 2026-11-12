/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { Direction, Grid, Sizing } from '../../../../base/browser/ui/grid/grid.js';
import { Emitter } from '../../../../base/common/event.js';
import { Color } from '../../../../base/common/color.js';
import { Disposable, DisposableMap, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { MenuWorkbenchToolBar } from '../../../../platform/actions/browser/toolbar.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EDITOR_GROUP_BORDER } from '../../../common/theme.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { PiChatConversationGroup } from './PiChatConversationGroup.js';
import { PiChatSessionCreationService } from './PiChatSessionCreationService.js';
import { IPiChatSelectionService, PiChatSessionOpenOptions } from './PiChatSelectionService.js';
import { PiChatRepoPicker } from './sidebar/PiChatRepoPicker.js';

/** Smart secondary chat container: grid layout, retained groups, and new-chat coordination. */
export class PiChatConversationContainer extends Disposable {
	private readonly host: HTMLElement;
	private readonly globalActions = $('.global-actions');
	private readonly titleChanged = this._register(new Emitter<void>());
	readonly onDidChangeTitle = this.titleChanged.event;

	get titleControl(): HTMLElement | undefined {
		return this.selection.groups.length === 1 ? this.groups.get(this.selection.groups[0].id)?.tabs.element : undefined;
	}
	private readonly groups = this._register(new DisposableMap<number, PiChatConversationGroup>());
	private readonly picker = this._register(new MutableDisposable<PiChatRepoPicker>());
	private grid: Grid<PiChatConversationGroup> | undefined;
	private width = 0;
	private height = 0;

	constructor(parent: HTMLElement, @IPiChatSelectionService private readonly selection: IPiChatSelectionService,
		@IInstantiationService private readonly instantiation: IInstantiationService,
		@IThemeService private readonly theme: IThemeService,
	) {
		super();
		this.host = append(parent, $('.pi-chat-groups'));
		this._register(instantiation.createInstance(MenuWorkbenchToolBar, this.globalActions, MenuId.AuxiliaryBarTitle, { telemetrySource: 'piChatTitle' }));
		this._register(selection.onDidChangeGroups(() => this.updateGroups()));
		this._register(theme.onDidColorThemeChange(() => this.styleGrid()));
		this.updateGroups();
	}

	async newChat(folder?: URI, options: PiChatSessionOpenOptions = {}): Promise<void> {
		const target = { ...options, groupId: options.groupId ?? this.selection.activeGroupId };
		if (folder) {
			const draft = await this.instantiation.createInstance(PiChatSessionCreationService).createDraft(folder);
			if (draft && !this._store.isDisposed) { this.selection.selectSession(draft, target); }
		} else {
			this.picker.value = this.instantiation.createInstance(PiChatRepoPicker, this.host, () => this.picker.clear(), target);
		}
	}

	private updateGroups(): void {
		for (const state of this.selection.groups) {
			let group = this.groups.get(state.id);
			if (!group) {
				group = this.instantiation.createInstance(PiChatConversationGroup, state.id, () => { void this.newChat(undefined, { groupId: state.id }); });
				this.groups.set(state.id, group);
				if (!this.grid) {
					this.grid = this._register(new Grid(group));
					this.styleGrid();
					this.host.appendChild(this.grid.element);
				} else {
					const reference = this.groups.get(state.referenceGroupId ?? this.selection.groups[0].id) ?? this.groups.values().next().value!;
					this.grid.addView(group, Sizing.Distribute, reference, state.direction ?? Direction.Right);
				}
			}
			group.update(state);
		}
		for (const [id, group] of this.groups) {
			if (!this.selection.groups.some(state => state.id === id)) {
				this.grid?.removeView(group, Sizing.Distribute);
				this.groups.deleteAndDispose(id);
			}
		}
		const rightmostId = this.selection.groups[this.selection.groups.length - 1].id;
		for (const group of this.groups.values()) {
			group.showLocalTitle(this.selection.groups.length > 1, group.id === rightmostId ? this.globalActions : undefined);
			group.setShowOpenAILimits(group.id === rightmostId);
		}
		this.titleChanged.fire();
		this.layoutGrid();
	}

	layout(width: number, height: number): void {
		this.width = width;
		this.height = height;
		this.layoutGrid();
	}

	private styleGrid(): void {
		this.grid?.style({ separatorBorder: this.theme.getColorTheme().getColor(EDITOR_GROUP_BORDER) ?? Color.transparent });
	}

	private layoutGrid(): void {
		if (!this.grid) { return; }
		// Keep every split reachable even when the side bar is narrower than the grid's constraints.
		const width = Math.max(this.width, this.grid.minimumWidth);
		const height = Math.max(this.height, this.grid.minimumHeight);
		this.grid.element.style.width = `${width}px`;
		this.grid.element.style.height = `${height}px`;
		this.grid.layout(width, height);
	}

	insertFiles(resources: readonly URI[]): boolean {
		return this.groups.get(this.selection.activeGroupId)?.insertFiles(resources) ?? false;
	}
}
