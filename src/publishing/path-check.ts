import { App, FileSystemAdapter, Platform, TFolder, normalizePath } from 'obsidian';
import { expandHomePath } from './paths';
import { loadDesktopNodeModules, type PathApi } from './node-api';

/**
 * A path typed into settings is only useful if it points where the user thinks
 * it does. Both publishing paths are therefore checked as they are edited, and
 * the result is reported under the field.
 */
export type PathCheckLevel = 'ok' | 'warn' | 'error';

export interface PathCheck {
	level: PathCheckLevel;
	message: string;
}

/** The source is inside the vault, so the vault API answers this on mobile too. */
export function checkPublishingSource(app: App, value: string): PathCheck | null {
	const folder = normalizeVaultFolder(value);
	if (!folder) return null;
	const entry = app.vault.getAbstractFileByPath(folder);
	if (!entry) return { level: 'error', message: `Not found in the vault: ${folder}` };
	if (!(entry instanceof TFolder)) {
		return { level: 'error', message: `${folder} is a file, not a folder.` };
	}
	const publishable = entry.children.filter(
		(child) => child instanceof TFolder && !child.name.startsWith('.'),
	).length;
	if (publishable === 0) {
		return { level: 'warn', message: `${folder} exists but has no subfolders to publish yet.` };
	}
	return {
		level: 'ok',
		message: `${folder} · ${publishable} ${publishable === 1 ? 'subfolder' : 'subfolders'} can be published.`,
	};
}

/**
 * The destination lives outside the vault, so it is read through Node and the
 * same rules the publishing command enforces are applied here, before a run.
 */
export async function checkPublishingTarget(app: App, value: string): Promise<PathCheck | null> {
	const setting = value.trim();
	if (!setting) return null;
	if (!Platform.isDesktopApp || !(app.vault.adapter instanceof FileSystemAdapter)) {
		return { level: 'warn', message: 'Folder publishing is available only in the desktop app.' };
	}

	const { pathModule, fileSystem, osModule } = loadDesktopNodeModules();
	const expanded = expandHomePath(setting, osModule.homedir());
	if (!pathModule.isAbsolute(expanded)) {
		return { level: 'error', message: 'Enter an absolute path, or one starting with ~/.' };
	}
	const targetRoot = pathModule.resolve(expanded);
	if (targetRoot === pathModule.parse(targetRoot).root) {
		return { level: 'error', message: 'The file system root cannot be the destination.' };
	}
	const vaultRoot = pathModule.resolve(app.vault.adapter.getBasePath());
	if (isInside(vaultRoot, targetRoot, pathModule) || isInside(targetRoot, vaultRoot, pathModule)) {
		return { level: 'error', message: 'The destination must be outside this vault.' };
	}

	try {
		const stats = await fileSystem.lstat(targetRoot);
		if (stats.isSymbolicLink()) {
			return { level: 'error', message: `${targetRoot} is a symbolic link.` };
		}
		if (!stats.isDirectory()) {
			return { level: 'error', message: `${targetRoot} is a file, not a folder.` };
		}
		return { level: 'ok', message: `Found: ${targetRoot}` };
	} catch (error) {
		if (isMissingFileError(error)) {
			// A destination that is not there yet still publishes; it is only
			// worth saying so, because every file will then look new.
			return { level: 'warn', message: `${targetRoot} does not exist yet; it will be created on the first publish.` };
		}
		return { level: 'error', message: `Could not read ${targetRoot}: ${errorMessage(error)}` };
	}
}

function normalizeVaultFolder(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	return normalizePath(trimmed).replace(/^\/+|\/+$/g, '');
}

function isInside(parent: string, child: string, pathModule: PathApi): boolean {
	const result = pathModule.relative(parent, child);
	return result === '' || (!result.startsWith('..') && !pathModule.isAbsolute(result));
}

function isMissingFileError(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
