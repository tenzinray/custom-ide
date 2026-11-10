/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isExcludedFromProfileMigration, syncTree } from './profileCopy.ts';
import { findProcessesUsingProfile, PERSISTENT_PROFILE_MARKER, PROFILE_MIGRATION_MARKER } from './runDirs.ts';

export interface IPersistentProfileSeed {
	readonly sourceUserDataDir: string;
	readonly sourceExtensionsDir: string;
	readonly sourceSharedDataDir: string;
}

/** Normal user launches keep their state here; agent/test launches remain isolated. */
export function getPersistentProfileDirectory(): string {
	return path.resolve(process.env.CODE_OSS_DEV_PERSISTENT_PROFILE_DIR ?? path.join(os.homedir(), '.vscode-oss-dev-profile'));
}

export function getProfileMigrationFile(): string {
	return path.resolve(process.env.CODE_OSS_DEV_PROFILE_MIGRATION_FILE ?? `${getPersistentProfileDirectory()}.migration.json`);
}

/** Queue paths only, never copy a live profile. Keep a temporary source safe from launcher GC. */
export async function queueProfileMigration(seed: IPersistentProfileSeed, migrationFile = getProfileMigrationFile(), directory = getPersistentProfileDirectory()): Promise<void> {
	validateSeed(seed);
	if (existsSync(path.join(directory, PERSISTENT_PROFILE_MARKER))) {
		throw new Error('The permanent profile is already initialized; refusing to replace it.');
	}
	await fs.mkdir(path.dirname(migrationFile), { recursive: true });
	if (path.basename(seed.sourceUserDataDir) === 'user-data') {
		await fs.writeFile(path.join(path.dirname(seed.sourceUserDataDir), PROFILE_MIGRATION_MARKER), '', { mode: 0o600 });
	}
	await fs.writeFile(migrationFile, JSON.stringify(seed, null, 2) + '\n', { mode: 0o600 });
}

/** Seed once, while closed, then never synchronize over later settings or sign-ins. */
export async function preparePersistentProfile(fallback: IPersistentProfileSeed): Promise<string> {
	const directory = getPersistentProfileDirectory();
	if (existsSync(path.join(directory, PERSISTENT_PROFILE_MARKER))) { return directory; }
	if (existsSync(directory)) { throw new Error(`Refusing to overwrite an unrecognized permanent profile: ${directory}`); }
	const migrationFile = getProfileMigrationFile();
	let seed = fallback;
	let pending = false;
	try {
		seed = JSON.parse(await fs.readFile(migrationFile, 'utf8')) as IPersistentProfileSeed;
		pending = true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
	}
	validateSeed(seed);
	if (findProcessesUsingProfile(seed.sourceUserDataDir).length) {
		throw new Error('Quit the source Code OSS app completely before migrating its profile. No files were copied and the running app was not changed.');
	}
	if (pending && !await isDirectory(seed.sourceUserDataDir)) {
		throw new Error('The queued migration source is missing; refusing to start with an empty profile.');
	}
	for (const source of [seed.sourceUserDataDir, seed.sourceExtensionsDir, seed.sourceSharedDataDir]) {
		const relative = path.relative(source, directory);
		if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
			throw new Error('The permanent profile cannot be inside its migration source.');
		}
	}

	await fs.mkdir(path.dirname(directory), { recursive: true });
	const staging = await fs.mkdtemp(path.join(path.dirname(directory), `.${path.basename(directory)}-migration-`));
	try {
		const copy = async (source: string, destination: string) => {
			await fs.mkdir(destination, { recursive: true });
			if (await isDirectory(source)) { await syncTree(source, destination, undefined, isExcludedFromProfileMigration); }
		};
		await copy(seed.sourceUserDataDir, path.join(staging, 'user-data'));
		const extensionsDir = path.join(staging, 'user-data', 'extensions');
		if (path.resolve(seed.sourceExtensionsDir) !== path.join(path.resolve(seed.sourceUserDataDir), 'extensions') || !await isDirectory(extensionsDir)) {
			await fs.rm(extensionsDir, { recursive: true, force: true });
			await copy(seed.sourceExtensionsDir, extensionsDir);
		}
		await copy(seed.sourceSharedDataDir, path.join(staging, 'shared-data'));
		await fs.writeFile(path.join(staging, PERSISTENT_PROFILE_MARKER), JSON.stringify({ version: 1, initializedAt: new Date().toISOString() }) + '\n');
		// Publish the complete profile at once; a failed migration never becomes a launchable profile.
		await fs.rename(staging, directory);
	} catch (error) {
		await fs.rm(staging, { recursive: true, force: true });
		throw error;
	}
	if (pending) {
		await fs.rm(migrationFile, { force: true });
		if (path.basename(seed.sourceUserDataDir) === 'user-data') {
			await fs.rm(path.join(path.dirname(seed.sourceUserDataDir), PROFILE_MIGRATION_MARKER), { force: true });
		}
	}
	return directory;
}

function validateSeed(seed: IPersistentProfileSeed): void {
	if (!seed || ![seed.sourceUserDataDir, seed.sourceExtensionsDir, seed.sourceSharedDataDir].every(value => typeof value === 'string' && path.isAbsolute(value))) {
		throw new Error('Profile migration requires absolute source profile, extensions and shared-data paths.');
	}
}

async function isDirectory(directory: string): Promise<boolean> {
	return fs.stat(directory).then(stat => stat.isDirectory(), () => false);
}
