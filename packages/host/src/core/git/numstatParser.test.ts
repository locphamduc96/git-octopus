import { describe, expect, it } from 'vitest';
import { parseNumstat } from './numstatParser.js';

describe('parseNumstat', () => {
	it('reads added and deleted counts per file', () => {
		const map = parseNumstat('12\t3\tsrc/a.ts\n0\t7\tsrc/b.ts');
		expect(map.get('src/a.ts')).toEqual({ additions: 12, deletions: 3 });
		expect(map.get('src/b.ts')).toEqual({ additions: 0, deletions: 7 });
	});

	it('treats binary files (reported as "-") as zero', () => {
		expect(parseNumstat('-\t-\timage.png').get('image.png')).toEqual({
			additions: 0,
			deletions: 0,
		});
	});

	it('keys a plain rename by its new path', () => {
		const map = parseNumstat('1\t1\told.ts => new.ts');
		expect(map.has('new.ts')).toBe(true);
	});

	it('rebuilds the new path for a rename with a shared prefix and suffix', () => {
		const map = parseNumstat('2\t0\tsrc/{old => new}/file.ts');
		expect(map.has('src/new/file.ts')).toBe(true);
	});

	it('returns nothing for empty output', () => {
		expect(parseNumstat('').size).toBe(0);
	});
});
