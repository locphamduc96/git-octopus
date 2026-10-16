import { describe, expect, it } from 'vitest';
import { matchesLfs } from './lfs';

describe('matchesLfs', () => {
	it('matches a bare pattern against the file name at any depth', () => {
		expect(matchesLfs('art/hero.psd', ['*.psd'])).toBe(true);
		expect(matchesLfs('art/hero.png', ['*.psd'])).toBe(false);
	});

	it('matches a pattern with a slash from the repository root, ** spanning folders', () => {
		expect(matchesLfs('assets/sfx/hit.wav', ['assets/**/*.wav'])).toBe(true);
		expect(matchesLfs('assets/hit.wav', ['assets/**/*.wav'])).toBe(true);
		expect(matchesLfs('other/assets/hit.wav', ['assets/**/*.wav'])).toBe(false);
		expect(matchesLfs('data/levels.bin', ['/data/*.bin'])).toBe(true);
	});

	it('keeps * inside one folder', () => {
		expect(matchesLfs('data/deep/levels.bin', ['data/*.bin'])).toBe(false);
	});
});
