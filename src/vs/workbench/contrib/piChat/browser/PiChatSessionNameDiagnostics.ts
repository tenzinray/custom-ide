/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { getPiChatSessionLabel, PiChatSessionSummary } from '../common/pi-chat-types.js';

/** Dev-only name provenance. Never records transcript lines, prompts, or file paths. */
export class PiChatSessionNameDiagnostics {
	private readonly names = new Map<string, { name: string | undefined; label: string }>();

	constructor(private readonly enabled: boolean, private readonly log: ILogService) { }

	record(source: string, session?: Pick<PiChatSessionSummary, 'id' | 'sessionName'>, details?: Readonly<Record<string, string | number | boolean | null | undefined>>): void {
		if (!this.enabled) { return; }
		this.log.info('[Pi Chat Names]', JSON.stringify({ source, sessionId: session?.id, name: session?.sessionName ?? null, ...details }));
	}

	observe(source: string, session: PiChatSessionSummary, requestId?: number): void {
		if (!this.enabled) { return; }
		const key = `${source}:${session.id}`;
		const previous = this.names.get(key);
		const label = getPiChatSessionLabel(session);
		if (previous && previous.name === session.sessionName && previous.label === label) { return; }
		this.names.set(key, { name: session.sessionName, label });
		if (this.names.size > 500) { this.names.delete(this.names.keys().next().value!); }
		this.record(source, session, { requestId, initial: !previous, previousName: previous?.name ?? null, previousLabel: previous?.label ?? null, label });
	}
}
