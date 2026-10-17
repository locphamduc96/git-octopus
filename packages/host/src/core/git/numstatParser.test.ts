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

	it('keys a rename that moves a file out of a folder by the flattened path', () => {
		const map = parseNumstat('1\t0\tsrc/{old => }/x.ts');
		expect([...map.keys()]).toEqual(['src/x.ts']);
	});

	it('keys a rename that moves a file into a new folder by the nested path', () => {
		const map = parseNumstat('1\t0\tsrc/{ => sub}/x.ts');
		expect([...map.keys()]).toEqual(['src/sub/x.ts']);
	});

	it('skips a line that has counts but no path', () => {
		expect(parseNumstat('4\t2\t').size).toBe(0);
		expect(parseNumstat('4\t2').size).toBe(0);
	});

	it('keeps separate counts for several files in one output', () => {
		const map = parseNumstat('1\t2\ta.ts\n3\t4\tsrc/{old => new}/b.ts\n-\t-\tc.png\n5\t6\td.ts');
		expect(map.size).toBe(4);
		expect(map.get('a.ts')).toEqual({ additions: 1, deletions: 2 });
		expect(map.get('src/new/b.ts')).toEqual({ additions: 3, deletions: 4 });
		expect(map.get('c.png')).toEqual({ additions: 0, deletions: 0 });
		expect(map.get('d.ts')).toEqual({ additions: 5, deletions: 6 });
	});

	it('returns nothing for empty output', () => {
		expect(parseNumstat('').size).toBe(0);
	});
});
