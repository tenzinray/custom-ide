/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

/** Shared relative reset text for header quotas and account menu status. */
export function formatOpenAILimitReset(resetsAt: number, now = Date.now()): string {
	const minutes = Math.max(0, Math.ceil((resetsAt * 1000 - now) / 60_000));
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor((minutes % 1440) / 60);
	if (days) { return localize('piChat.resetDaysHours', "{0}d {1}h", days, hours); }
	if (hours) { return localize('piChat.resetHoursMinutes', "{0}h {1}m", hours, minutes % 60); }
	return localize('piChat.resetMinutes', "{0}m", minutes);
}
