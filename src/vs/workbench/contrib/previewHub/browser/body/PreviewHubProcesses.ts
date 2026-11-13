/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { previewHubApps } from '../../../../../platform/previewHub/common/previewHubApps.js';
import { PreviewHubProcessState } from '../../../../../platform/previewHub/common/preview-hub-types.js';

/** Collapsible process diagnostics; polling preserves disclosure state and unchanged content. */
export class PreviewHubProcesses {
	private readonly summary: HTMLElement;
	private readonly list: HTMLElement;
	private signature: string | undefined;

	constructor(parent: HTMLElement, private readonly app: typeof previewHubApps[number]) {
		const details = append(parent, $('details.preview-hub-processes'));
		this.summary = append(details, $('summary', {}, localize('previewHub.processes', "Processes & Ports")));
		this.list = append(details, $('.preview-hub-process-list'));
	}

	update(processes: readonly PreviewHubProcessState[] = []): void {
		const signature = JSON.stringify(processes);
		if (signature === this.signature) { return; }
		this.signature = signature;
		this.summary.textContent = localize('previewHub.processCount', "Processes & Ports ({0})", processes.length);
		clearNode(this.list);
		if (!processes.length) { append(this.list, $('p.preview-hub-note', {}, localize('previewHub.noProcesses', "No running processes detected."))); }
		for (const process of processes) {
			const row = append(this.list, $('.preview-hub-process'));
			const component = this.app.components.find(component => component.id === process.componentId);
			append(row, $('strong', {}, localize('previewHub.processPid', "{0} · PID {1}", component?.name ?? process.componentId, process.pid)));
			for (const url of process.urls) { append(row, $('code.preview-hub-process-address', {}, url)); }
			if (!process.urls.length) { append(row, $('span.preview-hub-note', {}, localize('previewHub.noPort', "No listening localhost port"))); }
		}
	}
}
