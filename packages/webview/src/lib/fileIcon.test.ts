import { describe, expect, it } from 'vitest';
import type { FileIconTheme } from '@git-octopus/shared';
import { fontFaceCss, lookupFileIcon, lookupFolderIcon } from './fileIcon';

const THEME: FileIconTheme = {
	mapIcons: {
		ts: { kind: 'image', src: 'ts.svg' },
		test: { kind: 'image', src: 'test.svg' },
		docker: { kind: 'image', src: 'docker.svg' },
		fallback: { kind: 'image', src: 'file.svg' },
		folder: { kind: 'image', src: 'folder.svg' },
		folderOpen: { kind: 'image', src: 'folder-open.svg' },
		src: { kind: 'image', src: 'src.svg' },
	},
	listFonts: [],
	file: 'fallback',
	folder: 'folder',
	folderExpanded: 'folderOpen',
	mapFileNames: { dockerfile: 'docker' },
	mapFileExtensions: { ts: 'ts', 'test.ts': 'test' },
	mapFolderNames: { src: 'src' },
	mapFolderNamesExpanded: {},
};

describe('lookupFileIcon', () => {
	it('matches the whole file name before any extension', () => {
		expect(lookupFileIcon(THEME, 'build/Dockerfile')).toEqual(THEME.mapIcons.docker);
	});

	it('prefers the longest matching extension', () => {
		expect(lookupFileIcon(THEME, 'src/app.test.ts')).toEqual(THEME.mapIcons.test);
		expect(lookupFileIcon(THEME, 'src/app.ts')).toEqual(THEME.mapIcons.ts);
	});

	it('falls back to the theme default, then to nothing', () => {
		expect(lookupFileIcon(THEME, 'notes.unknown')).toEqual(THEME.mapIcons.fallback);
		expect(lookupFileIcon({ ...THEME, file: null }, 'notes.unknown')).toBeNull();
		expect(lookupFileIcon(null, 'src/app.ts')).toBeNull();
	});
});

describe('lookupFolderIcon', () => {
	it('uses the named icon, then the default for the open or closed state', () => {
		expect(lookupFolderIcon(THEME, 'src', false)).toEqual(THEME.mapIcons.src);
		expect(lookupFolderIcon(THEME, 'other', true)).toEqual(THEME.mapIcons.folderOpen);
		expect(lookupFolderIcon(THEME, 'other', false)).toEqual(THEME.mapIcons.folder);
	});

	it('falls back to the closed icon when a theme styles no open folder', () => {
		const theme = { ...THEME, folderExpanded: null };
		expect(lookupFolderIcon(theme, 'other', true)).toEqual(THEME.mapIcons.folder);
	});
});

describe('fontFaceCss', () => {
	it('declares each font a glyph theme ships', () => {
		const css = fontFaceCss({
			...THEME,
			listFonts: [
				{ id: 'seti', listSrc: [{ url: 'seti.woff', format: 'woff' }], weight: 'normal' },
			],
		});
		expect(css).toContain('font-family: "seti"');
		expect(css).toContain('src: url("seti.woff") format("woff")');
		expect(css).toContain('font-weight: normal');
	});

	it('is empty for an image theme', () => {
		expect(fontFaceCss(THEME)).toBe('');
	});
});
