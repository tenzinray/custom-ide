/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { safeIntl } from '../../../../../base/common/date.js';
import { PiChatSessionHistory, PiChatSessionSummary } from '../../common/pi-chat-types.js';

const tokenFormatter = safeIntl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const percentFormatter = safeIntl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 });
const formatTokens = (count: number) => tokenFormatter.value.format(count);

/** Saved token totals; the workbench tab already identifies the repository. */
export function renderPiChatHeader(header: HTMLElement, summary: PiChatSessionSummary | undefined, history: PiChatSessionHistory | undefined): void {
	clearNode(header);
	if (history && !summary?.isDraft) {
		const stats = append(header, $('.pi-chat-usage-stats', { 'aria-label': 'Saved session token usage' }));
		for (const [label, value] of [
			['Input', formatTokens(history.usage.input)], ['Output', formatTokens(history.usage.output)],
			['Cache read', formatTokens(history.usage.cacheRead)],
			['Context', history.usage.contextWindow ? percentFormatter.value.format(history.usage.contextTokens / history.usage.contextWindow) : '—'],
		]) {
			const stat = append(stats, $('.pi-chat-usage-stat'));
			append(stat, $('span', {}, label));
			append(stat, $('strong', {}, value));
		}
	}
}
