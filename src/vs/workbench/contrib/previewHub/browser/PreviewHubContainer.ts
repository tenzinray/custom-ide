/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IPathService } from '../../../../platform/path/common/pathService.js';
import { IPreviewHubService, previewHubBatteryCutoff, previewHubCaffeineCommand, previewHubLauncherLogPath } from '../../../../platform/previewHub/common/previewHub.js';
import { previewHubApps, PreviewHubAppId } from '../../../../platform/previewHub/common/previewHubApps.js';
import { PreviewHubSnapshot } from '../../../../platform/previewHub/common/preview-hub-types.js';
import { getProjectsDirectory } from '../../../../platform/workspaces/common/projectDirectories.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { PreviewHubAppCard } from './body/PreviewHubAppCard.js';
import { PreviewHubHeader } from './header/PreviewHubHeader.js';

/** Smart parent owns app controls, editor navigation, trust checks, and shared snapshot subscriptions. */
export class PreviewHubContainer extends Disposable {
	private readonly cards = new Map<PreviewHubAppId, PreviewHubAppCard>();
	private readonly pending = new Set<PreviewHubAppId>();
	private readonly header: PreviewHubHeader;
	private readonly error: HTMLElement;
	private state: PreviewHubSnapshot | undefined;

	constructor(parent: HTMLElement,
		@IPreviewHubService private readonly hub: IPreviewHubService,
		@IEditorService private readonly editors: IEditorService,
		@IOpenerService opener: IOpenerService,
		@IFileService private readonly files: IFileService,
		@IPathService private readonly paths: IPathService,
		@INotificationService private readonly notifications: INotificationService,
		@ICommandService commands: ICommandService,
		@IWorkspaceTrustManagementService private readonly trust: IWorkspaceTrustManagementService,
	) {
		super();
		const shell = append(parent, $('.preview-hub'));
		this.header = this._register(new PreviewHubHeader(shell, () => { void commands.executeCommand(previewHubCaffeineCommand).catch(error => notifications.error(error)); }));
		const body = append(shell, $('.preview-hub-body'));
		for (const app of previewHubApps) {
			this.cards.set(app.id, this._register(new PreviewHubAppCard(body, app,
				() => { void this.control(app.id, true); }, () => { void this.control(app.id, false); },
				() => { const url = this.state?.apps.find(state => state.id === app.id)?.previewUrl; if (url) { void opener.open(URI.parse(url)); } },
				path => { void this.openLog(app.id, path); })));
		}
		const footer = append(shell, $('footer.preview-hub-footer'));
		append(footer, $('p', {}, localize('previewHub.footer', "Status reflects local processes, not backend health. Logs update in their editor tabs.")));
		append(footer, $('p', {}, localize('previewHub.cutoff', "Caffeinate keeps the display awake on battery too. Below {0}% on battery it turns off. It never turns itself back on.", previewHubBatteryCutoff)));
		this.error = append(footer, $('p.preview-hub-error', { role: 'status' }));
		this._register(hub.onDidChange(state => this.update(state)));
		void hub.getSnapshot().then(state => { if (!this._store.isDisposed) { this.update(state); } }, error => notifications.error(error));
	}

	private update(state: PreviewHubSnapshot): void {
		this.state = state;
		this.header.update(state.caffeine);
		this.error.textContent = state.error ?? '';
		for (const app of state.apps) { this.cards.get(app.id)?.update(app, this.pending.has(app.id)); }
	}

	private async control(id: PreviewHubAppId, start: boolean): Promise<void> {
		if (this.pending.has(id)) { return; }
		if (start && !this.trust.isWorkspaceTrusted()) {
			this.notifications.warn(localize('previewHub.trust', "Trust this workspace before starting local commands."));
			return;
		}
		this.pending.add(id);
		if (this.state) { this.update(this.state); }
		try { if (start) { await this.hub.start(id); } else { await this.hub.stop(id); } }
		catch (error) { this.notifications.error(error); }
		finally {
			this.pending.delete(id);
			if (!this._store.isDisposed) { this.update(await this.hub.getSnapshot()); }
		}
	}

	private async openLog(id: PreviewHubAppId, path?: string): Promise<void> {
		const app = previewHubApps.find(app => app.id === id)!;
		const state = this.state?.apps.find(state => state.id === id);
		const watcherLog = app.id === 'pide' && path === app.logs[0].path ? state?.watcherLog : undefined;
		const resource = watcherLog ? URI.file(watcherLog) : joinPath(getProjectsDirectory(this.paths.userHome({ preferLocal: true })), app.folder, path ?? previewHubLauncherLogPath);
		try {
			if (!await this.files.exists(resource)) { this.notifications.info(localize('previewHub.noLog', "This log has not been created yet. Start the app first.")); return; }
			await this.editors.openEditor({ resource, options: { pinned: true } });
		} catch (error) { this.notifications.error(error); }
	}
}
