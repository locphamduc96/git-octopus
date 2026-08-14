import { describe, expect, it } from 'vitest';
import { buildIconTheme, parseFontCharacter, type RawIconTheme } from './iconTheme.js';

const OPTIONS = {
	resolve: (path: string) => `webview:${path}`,
	light: false,
	mapLanguageExtensions: {} as Record<string, string[]>,
	mapLanguageFileNames: {} as Record<string, string[]>,
};

describe('buildIconTheme', () => {
	it('resolves image icons and lowercases the lookup keys', () => {
		const raw: RawIconTheme = {
			iconDefinitions: { ts: { iconPath: './icons/ts.svg' }, _file: { iconPath: './icons/_.svg' } },
			file: '_file',
			fileExtensions: { TS: 'ts' },
			fileNames: { 'Dockerfile': 'ts' },
		};
		const theme = buildIconTheme(raw, OPTIONS);
		expect(theme.mapIcons.ts).toEqual({ kind: 'image', src: 'webview:./icons/ts.svg' });
		expect(theme.mapFileExtensions.ts).toBe('ts');
		expect(theme.mapFileNames.dockerfile).toBe('ts');
		expect(theme.file).toBe('_file');
	});

	it('reads glyph icons, defaulting to the theme\'s first font', () => {
		const raw: RawIconTheme = {
			fonts: [{ id: 'seti', src: [{ path: './seti.woff', format: 'woff' }], size: '150%' }],
			iconDefinitions: { _r: { fontCharacter: '\\E001', fontColor: '#519aba' } },
			file: '_r',
		};
		const theme = buildIconTheme(raw, OPTIONS);
		expect(theme.mapIcons._r).toEqual({
			kind: 'glyph',
			char: '\uE001',
			fontId: 'seti',
			colour: '#519aba',
		});
		expect(theme.listFonts[0]).toEqual({
			id: 'seti',
			listSrc: [{ url: 'webview:./seti.woff', format: 'woff' }],
			weight: undefined,
			style: undefined,
			size: '150%',
		});
	});

	it('spreads a language icon over that language\'s extensions and file names', () => {
		const raw: RawIconTheme = {
			iconDefinitions: { js: { iconPath: './js.svg' }, node: { iconPath: './node.svg' } },
			languageIds: { javascript: 'js' },
			fileNames: { 'server.js': 'node' },
		};
		const theme = buildIconTheme(raw, {
			...OPTIONS,
			mapLanguageExtensions: { javascript: ['js', 'mjs'] },
			mapLanguageFileNames: { javascript: ['server.js'] },
		});
		expect(theme.mapFileExtensions.mjs).toBe('js');
		// A name the theme states directly outranks anything inferred from the language.
		expect(theme.mapFileNames['server.js']).toBe('node');
	});

	it('applies the light overrides only for a light colour theme', () => {
		const raw: RawIconTheme = {
			iconDefinitions: { dark: { iconPath: './dark.svg' }, light: { iconPath: './light.svg' } },
			file: 'dark',
			light: { file: 'light' },
		};
		expect(buildIconTheme(raw, OPTIONS).file).toBe('dark');
		expect(buildIconTheme(raw, { ...OPTIONS, light: true }).file).toBe('light');
	});

	it('ships only the definitions something points at', () => {
		const raw: RawIconTheme = {
			iconDefinitions: { used: { iconPath: './a.svg' }, unused: { iconPath: './b.svg' } },
			file: 'used',
		};
		expect(Object.keys(buildIconTheme(raw, OPTIONS).mapIcons)).toEqual(['used']);
	});

	it('drops definitions it cannot render instead of failing the whole theme', () => {
		const raw: RawIconTheme = {
			iconDefinitions: { broken: {}, ok: { iconPath: './a.svg' } },
			file: 'broken',
			fileExtensions: { ts: 'ok', md: 'missing' },
		};
		const theme = buildIconTheme(raw, OPTIONS);
		expect(theme.mapIcons.broken).toBeUndefined();
		expect(theme.mapIcons.missing).toBeUndefined();
		expect(theme.mapIcons.ok).toBeDefined();
		// The lookup still lists them; the view falls back when an id resolves to nothing.
		expect(theme.file).toBe('broken');
	});
});

describe('parseFontCharacter', () => {
	it('turns a CSS escape into the character it names', () => {
		expect(parseFontCharacter('\\E001')).toBe('\uE001');
		expect(parseFontCharacter('\\e0e2')).toBe('\uE0E2');
	});

	it('passes through a plain character', () => {
		expect(parseFontCharacter('A')).toBe('A');
	});
});
