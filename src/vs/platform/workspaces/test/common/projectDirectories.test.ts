/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { getDefaultWorkspacePath, getProjectsDirectory, getSavedWorkspacesDirectory } from '../../common/projectDirectories.js';

suite('Project directories', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('derives discovery, saves, and startup paths from the same user home', () => {
		const home = URI.file('/test-home');
		assert.deepStrictEqual([
			getProjectsDirectory(home).path,
			getSavedWorkspacesDirectory(home).path,
			getDefaultWorkspacePath(home).path,
		], [
			'/test-home/Documents/VSCode',
			'/test-home/Documents/VSCode/workspaces',
			'/test-home/Documents/VSCode/workspaces/main-ws.code-workspace',
		]);
	});
});
