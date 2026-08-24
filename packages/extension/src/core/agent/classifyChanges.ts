/**
 * Sort changed files into tiers that decide how much of each file the agent prompt carries.
 *
 * The working tree of an asset-heavy project (a Cocos game, say) is dominated by `.meta` and
 * `.scene` files that are huge, generated, and useless to read — but their *names* still matter
 * for grouping and for the message. So the prompt always carries every file name, and the tier
 * only decides whether the content rides along.
 */

export type ChangeTier =
	/** Real code or prose: the diff itself goes into the prompt (budget permitting). */
	| 'source'
	/** Generated or oversized text (`.meta`, `.scene`, lockfiles…): name + line counts only. */
	| 'asset'
	/** Binary: name + status only. */
	| 'binary'
	/** Matched the user's exclude patterns: name only, never any content. */
	| 'excluded';

export interface ChangeEntry {
	path: string;
	/** Porcelain status letter (`M`, `A`, `D`, `?`, `U`…). */
	status: string;
	/** Size on disk in bytes; absent when the file no longer exists (deleted). */
	bytes?: number;
}

export interface ClassifiedChange extends ChangeEntry {
	tier: ChangeTier;
}

/** Text files larger than this carry no diff — at that size they are data, not a change to read. */
export const MAX_SOURCE_BYTES = 50_000;

const LIST_BINARY_EXTENSIONS = [
	'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tga', 'psd', 'exr', 'ktx', 'astc',
	'mp3', 'ogg', 'wav', 'm4a', 'flac',
	'mp4', 'webm', 'mov',
	'ttf', 'otf', 'woff', 'woff2', 'eot', 'fnt',
	'zip', 'gz', 'tar', '7z', 'jar', 'bin', 'so', 'dylib', 'dll', 'exe', 'wasm',
	'pdf', 'fbx', 'glb', 'gltf', 'blend', 'vsix',
];

/** Generated / editor-owned text: worth naming, never worth reading. */
const LIST_ASSET_PATTERNS = [
	'*.meta', '*.scene', '*.prefab', '*.anim', '*.fire', '*.atlas', '*.plist', '*.asset',
	'*.unity', '*.mat', '*.controller',
	'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'Cargo.lock', 'composer.lock',
	'Gemfile.lock', 'poetry.lock', 'uv.lock', 'go.sum',
	'*.min.js', '*.min.css', '*.map', '*.svg.gz',
	'**/dist/**', '**/build/**', '**/out/**', '**/library/**', '**/temp/**',
	'dist/**', 'build/**', 'out/**', 'library/**', 'temp/**',
];

/**
 * Glob-lite: `**` crosses directories, `*` stays inside one segment, `?` is one character.
 * A pattern without a slash matches the basename anywhere in the tree.
 */
export function globToRegExp(pattern: string): RegExp {
	// Wildcards go through placeholders: a replacement containing `*` must not be re-replaced
	// by the next, narrower rule.
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*\*\//g, '\u0000')
		.replace(/\*\*/g, '\u0001')
		.replace(/\*/g, '[^/]*')
		.replace(/\?/g, '[^/]')
		.replace(/\u0000/g, '(?:.*/)?')
		.replace(/\u0001/g, '.*');
	const anchored = pattern.includes('/') ? `^${escaped}$` : `(?:^|/)${escaped}$`;
	return new RegExp(anchored);
}

function matchesAny(path: string, listPatterns: RegExp[]): boolean {
	return listPatterns.some((pattern) => pattern.test(path));
}

const LIST_ASSET_REGEXPS = LIST_ASSET_PATTERNS.map(globToRegExp);

function extensionOf(path: string): string {
	const dot = path.lastIndexOf('.');
	return dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
}

export function classifyChanges(
	listEntries: ChangeEntry[],
	listExcludePatterns: string[] = []
): ClassifiedChange[] {
	const listExcludeRegExps = listExcludePatterns
		.filter((pattern) => pattern.trim() !== '')
		.map(globToRegExp);
	return listEntries.map((entry) => ({ ...entry, tier: tierOf(entry, listExcludeRegExps) }));
}

function tierOf(entry: ChangeEntry, listExcludeRegExps: RegExp[]): ChangeTier {
	if (matchesAny(entry.path, listExcludeRegExps)) return 'excluded';
	if (LIST_BINARY_EXTENSIONS.includes(extensionOf(entry.path))) return 'binary';
	if (matchesAny(entry.path, LIST_ASSET_REGEXPS)) return 'asset';
	if (entry.bytes !== undefined && entry.bytes > MAX_SOURCE_BYTES) return 'asset';
	return 'source';
}
