import { describe, expect, it } from 'vitest';
import { UNCOMMITTED_HASH } from '@git-octopus/shared';
import { imageMime, imageSides } from './imageDiff.js';

describe('imageMime', () => {
	it('knows images by extension, in any case, and nothing else', () => {
		expect(imageMime('art/logo.PNG')).toBe('image/png');
		expect(imageMime('a.jpeg')).toBe('image/jpeg');
		expect(imageMime('src/board.ts')).toBeNull();
		expect(imageMime('dir.png/file')).toBeNull();
	});
});

describe('imageSides', () => {
	const base = { path: 'logo.png', context: 3 };

	it('reads a commit against its first parent, and its root against nothing', () => {
		expect(imageSides({ ...base, hash: 'c' }, ['p1', 'p2'])).toEqual({
			before: { kind: 'rev', rev: 'p1', path: 'logo.png' },
			after: { kind: 'rev', rev: 'c', path: 'logo.png' },
		});
		expect(imageSides({ ...base, hash: 'c' }, []).before).toBeNull();
	});

	it('follows a rename on the before side', () => {
		expect(imageSides({ ...base, oldPath: 'old.png', hash: 'c' }, ['p']).before).toEqual({
			kind: 'rev',
			rev: 'p',
			path: 'old.png',
		});
	});

	it('reads a range end to end, the working tree from disk', () => {
		expect(imageSides({ ...base, fromHash: 'a', toHash: UNCOMMITTED_HASH }, []).after).toEqual({
			kind: 'disk',
			path: 'logo.png',
		});
	});

	it('reads a working-tree file by the part asked for', () => {
		expect(imageSides({ ...base, side: 'unstaged' }, [])).toEqual({
			before: { kind: 'index', path: 'logo.png' },
			after: { kind: 'disk', path: 'logo.png' },
		});
		expect(imageSides({ ...base, side: 'staged' }, [])).toEqual({
			before: { kind: 'rev', rev: 'HEAD', path: 'logo.png' },
			after: { kind: 'index', path: 'logo.png' },
		});
		expect(imageSides({ ...base, untracked: true }, []).before).toBeNull();
	});
});
