import type { FileIcon, FileIconTheme } from '@git-octopus/shared';

/**
 * Pick the icon a file gets, following the order VS Code itself uses: the whole file name first,
 * then the longest matching extension, then the theme's default. Returns null when the theme has
 * nothing to offer, which is the caller's cue to fall back to a codicon.
 */
export function lookupFileIcon(theme: FileIconTheme | null, path: string): FileIcon | null {
	if (!theme) return null;
	const name = (path.split('/').pop() ?? path).toLowerCase();

	const byName = theme.mapFileNames[name];
	if (byName) return theme.mapIcons[byName] ?? null;

	// "component.test.tsx" tries "test.tsx" before "tsx", so a theme can single out compound
	// extensions without losing the plain one.
	const listParts = name.split('.');
	for (let i = 1; i < listParts.length; i++) {
		const id = theme.mapFileExtensions[listParts.slice(i).join('.')];
		if (id) return theme.mapIcons[id] ?? null;
	}

	return theme.file ? (theme.mapIcons[theme.file] ?? null) : null;
}

/** Pick the icon a folder gets. Expanded folders fall back to the closed icon when unstyled. */
export function lookupFolderIcon(
	theme: FileIconTheme | null,
	name: string,
	expanded: boolean
): FileIcon | null {
	if (!theme) return null;
	// A row can stand for several folders at once ("native/engine/android/app"), and a theme keys its
	// icons on single names — so the deepest one, which is what the row is really showing, decides.
	const key = (name.split('/').pop() ?? name).toLowerCase();

	const listCandidates = expanded
		? [
				theme.mapFolderNamesExpanded[key],
				theme.folderExpanded,
				theme.mapFolderNames[key],
				theme.folder,
			]
		: [theme.mapFolderNames[key], theme.folder];

	for (const id of listCandidates) {
		const icon = id ? theme.mapIcons[id] : undefined;
		if (icon) return icon;
	}
	return null;
}

/** The `@font-face` rules a glyph-based theme needs before its characters render. */
export function fontFaceCss(theme: FileIconTheme | null): string {
	if (!theme) return '';
	return theme.listFonts
		.filter((font) => font.listSrc.length > 0)
		.map((font) => {
			const src = font.listSrc
				.map((item) => `url("${item.url}")${item.format ? ` format("${item.format}")` : ''}`)
				.join(', ');
			return [
				'@font-face {',
				`font-family: "${font.id}";`,
				`src: ${src};`,
				font.weight ? `font-weight: ${font.weight};` : '',
				font.style ? `font-style: ${font.style};` : '',
				'}',
			]
				.filter(Boolean)
				.join(' ');
		})
		.join('\n');
}

/** The size a glyph font asks to be drawn at, relative to the surrounding text. */
export function glyphFontSize(theme: FileIconTheme | null, fontId: string): string | undefined {
	return theme?.listFonts.find((font) => font.id === fontId)?.size;
}
