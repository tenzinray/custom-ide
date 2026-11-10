/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { joinPath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { WORKSPACE_SUFFIX } from '../../workspace/common/workspace.js';

/** Shared local project root used by repository discovery and saved workspaces. */
export function getProjectsDirectory(userHome: URI): URI {
	return joinPath(userHome, 'Documents', 'VSCode');
}

/** Keep workspace files outside their member repositories. */
export function getSavedWorkspacesDirectory(userHome: URI): URI {
	return joinPath(getProjectsDirectory(userHome), 'workspaces');
}

/** Default for a fresh, local app launch with no explicitly requested paths. */
export function getDefaultWorkspacePath(userHome: URI): URI {
	return joinPath(getSavedWorkspacesDirectory(userHome), `main-ws${WORKSPACE_SUFFIX}`);
}
