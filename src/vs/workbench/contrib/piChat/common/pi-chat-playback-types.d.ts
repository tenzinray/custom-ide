/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Playback state shared by the Pi Listen extension command and its workbench control. */
export interface PiChatPlaybackStatus {
	readonly phase: 'idle' | 'generating' | 'playing' | 'paused';
	readonly playbackId?: string;
	readonly positionMs?: number;
	readonly durationMs?: number;
}
