import { Platform } from 'obsidian';

// A path copied out of a terminal arrives shell-escaped ("Doug\\ Su"), which
// resolves to a folder that does not exist and makes every file look new.
export function normalizePublishingTarget(value: string): string {
	let path = value.trim();
	const quote = path.charAt(0);
	if (path.length > 1 && (quote === '"' || quote === "'") && path.endsWith(quote)) {
		path = path.slice(1, -1);
	}
	// Backslash is a path separator on Windows, so only unescape elsewhere.
	if (!Platform.isWin) path = path.replace(/\\(?=[^A-Za-z0-9])/g, '');
	return path.replace(/[\\/]+$/, '') || path;
}

// A destination may be written relative to the home folder; the path is stored
// as typed and expanded only where the file system is actually touched.
export function expandHomePath(value: string, homeDirectory: string): string {
	const path = value.trim();
	if (path !== '~' && !path.startsWith('~/') && !(Platform.isWin && path.startsWith('~\\'))) {
		return path;
	}
	const rest = path.slice(1).replace(/^[\\/]+/, '');
	if (!rest) return homeDirectory;
	return `${homeDirectory.replace(/[\\/]+$/, '')}${Platform.isWin ? '\\' : '/'}${rest}`;
}
