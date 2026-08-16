import { describe, expect, it } from 'vitest';
import { parseSubmoduleStatus } from './gitService';

const SHA = 'a'.repeat(40);

describe('parseSubmoduleStatus', () => {
	it('parses initialised, uninitialised and out-of-date entries alike', () => {
		const output = [
			` ${SHA} libs/engine (v1.2.0)`,
			`+${'b'.repeat(40)} libs/tools (heads/main)`,
			`-${'c'.repeat(40)} vendor/sdk`,
			`U${'d'.repeat(40)} conflicted/path (x)`,
		].join('\n');
		expect(parseSubmoduleStatus(output)).toEqual([
			{ hash: 'a'.repeat(8), path: 'libs/engine' },
			{ hash: 'b'.repeat(8), path: 'libs/tools' },
			{ hash: 'c'.repeat(8), path: 'vendor/sdk' },
			{ hash: 'd'.repeat(8), path: 'conflicted/path' },
		]);
	});

	it('returns nothing for a repository without submodules', () => {
		expect(parseSubmoduleStatus('')).toEqual([]);
	});
});
