/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { PiChatOpenAILimitWindow } from '../../common/pi-chat-openai-limits-types.js';
import { IPiChatOpenAILimitsService } from '../PiChatOpenAILimitsService.js';
import { formatOpenAILimitReset } from '../openAILimitReset.js';

function renderWindow(parent: HTMLElement, label: string, window: PiChatOpenAILimitWindow): void {
	const used = Math.round(window.usedPercent);
	const row = append(parent, $('.pi-chat-limit-row' + (used >= 90 ? '.pi-chat-limit-high' : '')));
	const bar = append(row, $('.pi-chat-limit-bar', { role: 'progressbar', 'aria-label': localize('piChat.limitUsed', "{0} used", label), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(used) }));
	append(bar, $('.pi-chat-limit-fill')).style.width = `${window.usedPercent}%`;
	append(row, $('span.pi-chat-limit-label', {}, label));
	append(row, $('strong.pi-chat-limit-percent', {}, `${used}%`));
	const reset = new Date(window.resetsAt * 1000);
	append(row, $('time.pi-chat-limit-reset', { dateTime: reset.toISOString(), title: localize('piChat.limitResetAt', "Resets {0}", reset.toLocaleString()), 'aria-label': localize('piChat.limitResetIn', "Resets in {0}", formatOpenAILimitReset(window.resetsAt)) }, formatOpenAILimitReset(window.resetsAt)));
}

/** Compact account-wide usage, beside (but distinct from) per-session token totals. */
export function renderPiChatOpenAILimits(header: HTMLElement, service: IPiChatOpenAILimitsService): void {
	if (!service.limits && !service.refreshing && !service.error) { return; }
	const root = append(header, $('.pi-chat-openai-limits' + (service.error ? '.pi-chat-limits-stale' : '')));
	if (service.limits) {
		const rows = append(root, $('.pi-chat-limit-rows', { title: localize('piChat.limitUpdatedAt', "OpenAI usage updated {0}", new Date(service.limits.updatedAt).toLocaleTimeString()) }));
		if (service.limits.fiveHour) { renderWindow(rows, localize('piChat.limitFiveHour', "5h"), service.limits.fiveHour); }
		if (service.limits.weekly) { renderWindow(rows, localize('piChat.limitWeekly', "Week"), service.limits.weekly); }
	} else {
		append(root, $('span.pi-chat-limit-placeholder', {}, service.error ?? localize('piChat.loadingLimits', "Loading limits…")));
	}
	const refreshLabel = service.error ?? localize('piChat.refreshLimits', "Refresh OpenAI limits");
	const refresh = append(root, $('button.pi-chat-limit-refresh', { type: 'button', 'aria-label': refreshLabel, title: refreshLabel })) as HTMLButtonElement;
	append(refresh, $('span.codicon.codicon-refresh', { 'aria-hidden': 'true' }));
	refresh.disabled = service.refreshing;
	refresh.addEventListener('click', () => { void service.refresh(); });
}
