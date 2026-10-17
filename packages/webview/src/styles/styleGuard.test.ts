import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Keeps the view on its tokens: every colour, font size and corner in a component goes through
 * `tokens.css`, which is the only file that may name a --vscode-* variable or write a colour.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Files that may hold literal colours, each with the reason it is allowed to.
const mapColourAllowlist: Record<string, string> = {
	'styles/tokens.css': 'maps the theme variables to tokens',
	'lib/graphColours.ts': 'lane palette, kept unchanged by the 2026-10-17 review',
};

const RE_COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|var\(\s*--vscode-/;
const RE_FONT_SIZE =
	/^(?:inherit|var\(--gg-(?:text-(?:xs|sm|md|lg|mono)|icon-(?:xs|sm|md|lg)|font-size)\))$/;
const RE_RADIUS_PART = /^(?:0|50%|999px|inherit|var\(--gg-radius(?:-xs|-sm|-lg|-xl)?\))$/;
const RE_DECLARATION = /([-\w]+)\s*:\s*([^;{}]+)/g;

interface Violation {
	at: string;
	rule: 'colour' | 'font-size' | 'radius';
	text: string;
}

/** Blanks out comments, keeping every newline so reported lines still match the file. */
function stripComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

function lineAt(text: string, index: number): number {
	return text.slice(0, index).split('\n').length;
}

/** Checks one block of CSS; `lineOffset` places it inside its file. */
export function checkCss(
	path: string,
	css: string,
	lineOffset = 0,
	isColourAllowed = false
): Violation[] {
	const listViolations: Violation[] = [];
	const text = stripComments(css);
	for (const match of text.matchAll(RE_DECLARATION)) {
		const [, property, rawValue] = match;
		const value = rawValue.trim();
		const at = `${path}:${lineOffset + lineAt(text, match.index)}`;
		if (!isColourAllowed && RE_COLOUR.test(value))
			listViolations.push({ at, rule: 'colour', text: `${property}: ${value}` });
		if (property === 'font-size' && !RE_FONT_SIZE.test(value))
			listViolations.push({ at, rule: 'font-size', text: value });
		if (property.endsWith('radius') && !property.startsWith('--')) {
			const isTokens = value.split(/\s+(?![^(]*\))/).every((part) => RE_RADIUS_PART.test(part));
			if (!isTokens) listViolations.push({ at, rule: 'radius', text: value });
		}
	}
	return listViolations;
}

/** The `<style>` block of a component, and colour attributes in its markup. */
export function checkSvelte(path: string, source: string): Violation[] {
	const listViolations: Violation[] = [];
	for (const match of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
		const offset = lineAt(source, match.index) - 1;
		listViolations.push(...checkCss(path, match[1], offset));
	}
	const markup = source.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, (block) =>
		block.replace(/[^\n]/g, ' ')
	);
	for (const match of markup.matchAll(/\b(?:style(?::[-\w]+)?|fill|stroke|color)="([^"]*)"/g)) {
		if (RE_COLOUR.test(match[1])) {
			listViolations.push({
				at: `${path}:${lineAt(markup, match.index)}`,
				rule: 'colour',
				text: match[0],
			});
		}
	}
	return listViolations;
}

/** A colour written into a string in TypeScript, e.g. a palette that should be a token. */
export function checkTs(path: string, source: string): Violation[] {
	const listViolations: Violation[] = [];
	for (const match of source.matchAll(
		/['"`][^'"`\n]*(?:#[0-9a-fA-F]{3,8}\b|var\(\s*--vscode-)[^'"`\n]*['"`]/g
	)) {
		listViolations.push({
			at: `${path}:${lineAt(source, match.index)}`,
			rule: 'colour',
			text: match[0],
		});
	}
	return listViolations;
}

function listSourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return listSourceFiles(path);
		return /\.(svelte|css|ts)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
	});
}

function checkFile(absolute: string): Violation[] {
	const path = relative(ROOT, absolute);
	const source = readFileSync(absolute, 'utf8');
	if (path.endsWith('.svelte')) return checkSvelte(path, source);
	if (path.endsWith('.css')) return checkCss(path, source, 0, path in mapColourAllowlist);
	return path in mapColourAllowlist ? [] : checkTs(path, source);
}

describe('style guard', () => {
	it('keeps every colour, font size and corner on the tokens', () => {
		const listViolations = listSourceFiles(ROOT).flatMap(checkFile);
		expect(
			listViolations.map((violation) => `${violation.at}  [${violation.rule}] ${violation.text}`)
		).toEqual([]);
	});

	it('catches a colour, a size and a corner written by hand', () => {
		const listViolations = checkSvelte(
			'Fake.svelte',
			'<div style="color: #fff"></div>\n<style>\n\t.a { color: #c74e39; font-size: 0.9em; border-radius: 3px; }\n\t.b { background: var(--vscode-list-hoverBackground); }\n</style>'
		);
		expect(listViolations.map((violation) => `${violation.at} ${violation.rule}`)).toEqual([
			'Fake.svelte:3 colour',
			'Fake.svelte:3 font-size',
			'Fake.svelte:3 radius',
			'Fake.svelte:4 colour',
			'Fake.svelte:1 colour',
		]);
	});

	it('sees a theme variable split over two lines', () => {
		const css =
			'.a {\n\tbackground: var(\n\t\t--vscode-button-secondaryHoverBackground,\n\t\ttransparent\n\t);\n}';
		expect(checkCss('Split.svelte', css).map((violation) => violation.rule)).toEqual(['colour']);
	});

	it('lets tokens through', () => {
		const css =
			'.a { color: var(--gg-fg); font-size: var(--gg-text-sm); border-radius: var(--gg-radius) var(--gg-radius) 0 0; }';
		expect(checkCss('Fine.svelte', css)).toEqual([]);
	});
});
