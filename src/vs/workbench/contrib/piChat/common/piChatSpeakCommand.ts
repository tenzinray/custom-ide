/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Recognize literal Siri TTS invocations without evaluating shell substitutions or mixed commands. */
export function getPiChatSpeakText(command: string): string | undefined {
	let offset = 0;
	const token = (): string | undefined => {
		while (/\s/.test(command[offset] ?? '') && offset < command.length) { offset++; }
		let value = '';
		let quote: string | undefined;
		let started = false;
		while (offset < command.length) {
			const char = command[offset++];
			if (!quote && /\s/.test(char)) { break; }
			if (!quote && /[;&|<>]/.test(char)) { return undefined; }
			if (char === quote) { quote = undefined; started = true; continue; }
			if (!quote && (char === '"' || char === '\'')) { quote = char; started = true; continue; }
			if (quote !== '\'' && (char === '$' || char === '`')) { return undefined; }
			if (char === '\\' && quote !== '\'') {
				const next = command[offset++];
				if (next === undefined) { return undefined; }
				value += quote === '"' && !/["\\$`\n]/.test(next) ? `\\${next}` : next === '\n' ? '' : next;
			} else { value += char; }
			started = true;
		}
		return started && !quote ? value : undefined;
	};
	let executable = token();
	if (executable === 'bash' || executable === '/bin/bash') { executable = token(); }
	if (!executable || !/(?:^|\/)siri-tts\.sh$/.test(executable)) { return undefined; }
	const text = token();
	if (!text?.trim() || text.startsWith('--')) { return undefined; }
	// These only redirect or background speech. Anything else remains an ordinary shell tool.
	if (!/^(?:\s|(?:[12]?>>?|&>)\s*\/dev\/null|2>&1|&)*$/.test(command.slice(offset))) { return undefined; }
	return text;
}
