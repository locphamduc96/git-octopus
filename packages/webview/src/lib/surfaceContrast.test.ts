// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	FLAT_SURFACES_CLASS,
	contrastRatio,
	isFlat,
	parseRgb,
	watchSurfaceContrast,
} from './surfaceContrast';

describe('parseRgb', () => {
	it('reads rgb and rgba', () => {
		expect(parseRgb('rgb(31, 31, 31)')).toEqual([31, 31, 31]);
		expect(parseRgb('rgba(24, 24, 24, 0.5)')).toEqual([24, 24, 24]);
		expect(parseRgb('rgb(24 24 24 / 50%)')).toEqual([24, 24, 24]);
	});

	it('treats transparent and anything unreadable as unknown', () => {
		expect(parseRgb('rgba(0, 0, 0, 0)')).toBeNull();
		expect(parseRgb('')).toBeNull();
		expect(parseRgb('var(--gg-bg)')).toBeNull();
	});
});

describe('isFlat', () => {
	it('keeps the stock themes as they are', () => {
		expect(isFlat('rgb(31, 31, 31)', 'rgb(24, 24, 24)')).toBe(false);
		expect(isFlat('rgb(255, 255, 255)', 'rgb(248, 248, 248)')).toBe(false);
		expect(isFlat('rgb(30, 30, 30)', 'rgb(24, 24, 24)')).toBe(false);
	});

	it('flags a theme that paints the editor and the sidebar alike', () => {
		expect(isFlat('rgb(40, 42, 54)', 'rgb(40, 42, 54)')).toBe(true);
		expect(isFlat('rgb(255, 255, 255)', 'rgb(252, 252, 252)')).toBe(true);
	});

	it('leaves the tone alone when a colour cannot be read', () => {
		expect(isFlat('rgba(0, 0, 0, 0)', 'rgb(24, 24, 24)')).toBe(false);
	});

	it('measures contrast either way round', () => {
		expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
		expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
	});
});

describe('watchSurfaceContrast', () => {
	let stop: (() => void) | undefined;

	afterEach(() => {
		stop?.();
		vi.restoreAllMocks();
		document.documentElement.classList.remove(FLAT_SURFACES_CLASS);
	});

	function paint(mapColours: Record<string, string>): void {
		vi.spyOn(window, 'getComputedStyle').mockImplementation(
			(element) =>
				({
					backgroundColor:
						mapColours[(element as HTMLElement).style.backgroundColor] ?? 'rgba(0, 0, 0, 0)',
				}) as CSSStyleDeclaration
		);
	}

	it('marks the root while the theme is flat and clears it when the theme changes', async () => {
		const mapColours = {
			'var(--gg-bg)': 'rgb(40, 42, 54)',
			'var(--gg-bg-sidebar)': 'rgb(40, 42, 54)',
		};
		paint(mapColours);
		stop = watchSurfaceContrast();
		expect(document.documentElement.classList.contains(FLAT_SURFACES_CLASS)).toBe(true);

		mapColours['var(--gg-bg-sidebar)'] = 'rgb(24, 24, 24)';
		document.body.className = 'vscode-dark';
		await Promise.resolve();
		expect(document.documentElement.classList.contains(FLAT_SURFACES_CLASS)).toBe(false);
	});
});
