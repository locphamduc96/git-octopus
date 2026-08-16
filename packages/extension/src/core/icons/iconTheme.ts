import type { FileIcon, FileIconFont, FileIconTheme } from '@git-octopus/shared';

/**
 * The parts of a VS Code file-icon theme file we read. Everything is optional: themes only declare
 * what they cover, and a theme we cannot make sense of has to degrade rather than throw.
 *
 * See https://code.visualstudio.com/api/extension-guides/file-icon-theme
 */
export interface RawIconDefinition {
	iconPath?: string;
	fontCharacter?: string;
	fontColor?: string;
	fontId?: string;
}

export interface RawIconTheme {
	fonts?: {
		id?: string;
		src?: { path?: string; format?: string }[];
		weight?: string;
		style?: string;
		size?: string;
	}[];
	iconDefinitions?: Record<string, RawIconDefinition>;
	file?: string;
	folder?: string;
	folderExpanded?: string;
	fileExtensions?: Record<string, string>;
	fileNames?: Record<string, string>;
	folderNames?: Record<string, string>;
	folderNamesExpanded?: Record<string, string>;
	languageIds?: Record<string, string>;
	/** Overrides applied when the colour theme is a light one. */
	light?: Omit<RawIconTheme, 'light' | 'fonts' | 'iconDefinitions'>;
}

export interface BuildIconThemeOptions {
	/** Turns a path written in the theme file into something the webview can load. */
	resolve: (path: string) => string;
	/** Whether the active colour theme is light, which selects the theme's `light` overrides. */
	light: boolean;
	/** Extensions (no leading dot) registered for a language id, from the language registry. */
	mapLanguageExtensions: Record<string, string[]>;
	/** Whole file names registered for a language id, e.g. "makefile" for `make`. */
	mapLanguageFileNames: Record<string, string[]>;
}

/** Flatten a theme file into the lookup tables the webview needs. */
export function buildIconTheme(raw: RawIconTheme, options: BuildIconThemeOptions): FileIconTheme {
	const overlay = options.light ? (raw.light ?? {}) : {};

	const mapFileNames = lowerKeys({ ...raw.fileNames, ...overlay.fileNames });
	const mapFileExtensions = lowerKeys({ ...raw.fileExtensions, ...overlay.fileExtensions });
	const mapFolderNames = lowerKeys({ ...raw.folderNames, ...overlay.folderNames });
	const mapFolderNamesExpanded = lowerKeys({
		...raw.folderNamesExpanded,
		...overlay.folderNamesExpanded,
	});

	// A theme may map a language rather than every extension of it ("typescript" instead of ts, tsx,
	// mts…). Spread those over the extensions and file names the language registry knows, without
	// overwriting anything the theme stated directly.
	const mapLanguageIds = { ...raw.languageIds, ...overlay.languageIds };
	for (const [language, icon] of Object.entries(mapLanguageIds)) {
		for (const extension of options.mapLanguageExtensions[language] ?? []) {
			mapFileExtensions[extension] ??= icon;
		}
		for (const name of options.mapLanguageFileNames[language] ?? []) {
			mapFileNames[name] ??= icon;
		}
	}

	const file = overlay.file ?? raw.file ?? null;
	const folder = overlay.folder ?? raw.folder ?? null;
	const folderExpanded = overlay.folderExpanded ?? raw.folderExpanded ?? null;

	const listFonts = (raw.fonts ?? [])
		.filter((font) => typeof font.id === 'string')
		.map((font): FileIconFont => ({
			id: font.id as string,
			listSrc: (font.src ?? [])
				.filter((src) => typeof src.path === 'string')
				.map((src) => ({ url: options.resolve(src.path as string), format: src.format })),
			weight: font.weight,
			style: font.style,
			size: font.size,
		}));

	// Only the definitions something points at: a theme carries a full second set for light colour
	// themes, and shipping both would double a payload that already runs to hundreds of entries.
	const setUsed = new Set<string>(
		[
			file,
			folder,
			folderExpanded,
			...Object.values(mapFileNames),
			...Object.values(mapFileExtensions),
			...Object.values(mapFolderNames),
			...Object.values(mapFolderNamesExpanded),
		].filter((id): id is string => id !== null)
	);

	const mapIcons: Record<string, FileIcon> = {};
	for (const id of setUsed) {
		const icon = toIcon(raw.iconDefinitions?.[id], listFonts, options.resolve);
		if (icon) mapIcons[id] = icon;
	}

	return {
		mapIcons,
		listFonts,
		file,
		folder,
		folderExpanded,
		mapFileNames,
		mapFileExtensions,
		mapFolderNames,
		mapFolderNamesExpanded,
	};
}

function toIcon(
	definition: RawIconDefinition | undefined,
	listFonts: FileIconFont[],
	resolve: (path: string) => string
): FileIcon | null {
	if (!definition) return null;
	if (definition.iconPath) return { kind: 'image', src: resolve(definition.iconPath) };
	if (definition.fontCharacter) {
		const fontId = definition.fontId ?? listFonts[0]?.id;
		if (!fontId) return null;
		return {
			kind: 'glyph',
			char: parseFontCharacter(definition.fontCharacter),
			fontId,
			colour: definition.fontColor,
		};
	}
	return null;
}

/**
 * Theme files write glyphs as the CSS escape `"\\E001"`, which reaches us as the five characters
 * `\E001` rather than the character itself.
 */
export function parseFontCharacter(value: string): string {
	if (!value.startsWith('\\')) return value;
	const code = Number.parseInt(value.slice(1), 16);
	return Number.isNaN(code) ? value : String.fromCodePoint(code);
}

function lowerKeys(map: Record<string, string>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(map)) result[key.toLowerCase()] = value;
	return result;
}
