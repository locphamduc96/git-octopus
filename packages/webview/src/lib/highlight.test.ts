import { describe, expect, it } from 'vitest';
import { guessThemeKind, langForPath, tokenizeHunks } from './highlight';

describe('langForPath', () => {
	it('maps common extensions', () => {
		expect(langForPath('src/App.svelte')).toBe('svelte');
		expect(langForPath('packages/shared/src/index.ts')).toBe('typescript');
		expect(langForPath('a/b/component.test.tsx')).toBe('tsx');
		expect(langForPath('styles/main.SCSS')).toBe('scss');
		expect(langForPath('config.yml')).toBe('yaml');
	});

	it('maps special file names without extensions', () => {
		expect(langForPath('Dockerfile')).toBe('docker');
		expect(langForPath('tools/Makefile')).toBe('make');
	});

	it('returns null for unknown extensions', () => {
		expect(langForPath('assets/logo.spine')).toBeNull();
		expect(langForPath('data.bin')).toBeNull();
	});

	it('returns null for files without an extension', () => {
		expect(langForPath('LICENSE')).toBeNull();
		expect(langForPath('bin/run')).toBeNull();
	});

	it('returns null for dotfiles and trailing dots', () => {
		expect(langForPath('.gitignore')).toBeNull();
		expect(langForPath('weird.')).toBeNull();
	});
});

describe('guessThemeKind', () => {
	const body = (...listClasses: string[]) => ({
		classList: { contains: (name: string) => listClasses.includes(name) },
	});

	it('reads light variants from the body classes', () => {
		expect(guessThemeKind(body('vscode-light'))).toBe('light');
		expect(guessThemeKind(body('vscode-high-contrast-light'))).toBe('light');
	});

	it('defaults to dark', () => {
		expect(guessThemeKind(body('vscode-dark'))).toBe('dark');
		expect(guessThemeKind(body())).toBe('dark');
	});
});

describe('tokenizeHunks', () => {
	it('returns null for a language without a loader', () => {
		return expect(tokenizeHunks('no-such-lang', [['x']], 'dark')).resolves.toBeNull();
	});

	it('returns an empty list for no hunks', () => {
		return expect(tokenizeHunks('typescript', [], 'dark')).resolves.toEqual([]);
	});

	it('tokenizes hunk lines one row per line, preserving the text', async () => {
		const listHunkTexts = [['const listItems = [1];', ''], ['\treturn listItems;']];
		const listLines = await tokenizeHunks('typescript', listHunkTexts, 'dark');
		expect(listLines).not.toBeNull();
		expect(listLines).toHaveLength(3);
		const joined = listLines!.map((listTokens) =>
			listTokens.map((token) => token.content).join('')
		);
		expect(joined).toEqual(['const listItems = [1];', '', '\treturn listItems;']);
		expect(listLines![0].some((token) => token.color !== undefined)).toBe(true);
	});
});
