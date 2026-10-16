import { describe, expect, it } from 'vitest';
import { ignorePattern, withIgnoreEntry } from './gitignoreEntry.js';

describe('gitignore entry', () => {
	it('anchors the pattern to the repository root', () => {
		expect(ignorePattern('build/out.js')).toBe('/build/out.js');
	});

	it('adds the pattern to an empty file', () => {
		expect(withIgnoreEntry('', 'out.log')).toBe('/out.log\n');
	});

	it('repairs a missing final newline before appending', () => {
		expect(withIgnoreEntry('node_modules', 'out.log')).toBe('node_modules\n/out.log\n');
	});

	it('appends after a file that already ends in a newline', () => {
		expect(withIgnoreEntry('node_modules\n', 'out.log')).toBe('node_modules\n/out.log\n');
	});

	it('leaves the file alone when the anchored pattern is already there', () => {
		expect(withIgnoreEntry('/out.log\n', 'out.log')).toBeNull();
	});

	it('leaves the file alone when the same path is listed without the leading slash', () => {
		expect(withIgnoreEntry('out.log\n', 'out.log')).toBeNull();
	});

	it('ignores surrounding whitespace when looking for an existing entry', () => {
		expect(withIgnoreEntry('  /out.log  \n', 'out.log')).toBeNull();
	});
});
