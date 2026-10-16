import { describe, expect, it } from 'vitest';
import { parseFileHistory } from './fileHistory';
import { parseBlame } from './blame';

const R = '\x1e';
const U = '\x1f';
const header = (hash: string, subject: string) =>
	`${R}${hash}${U}Ada${U}ada@example.com${U}1700000000${U}${subject}`;

describe('parseFileHistory', () => {
	it('reads one entry per commit, with the name the file had at that commit', () => {
		const output = [
			`${header('c'.repeat(40), 'edit after the move')}\n\nM\tsrc/new.ts\n`,
			`${header('b'.repeat(40), 'move it')}\n\nR100\tsrc/old.ts\tsrc/new.ts\n`,
			`${header('a'.repeat(40), 'add it')}\n\nA\tsrc/old.ts\n`,
		].join('');
		const listEntries = parseFileHistory(output);
		expect(listEntries.map((entry) => [entry.status, entry.path, entry.oldPath])).toEqual([
			['M', 'src/new.ts', undefined],
			['R', 'src/new.ts', 'src/old.ts'],
			['A', 'src/old.ts', undefined],
		]);
		expect(listEntries[0]).toMatchObject({
			subject: 'edit after the move',
			author: { name: 'Ada', email: 'ada@example.com' },
			authoredAt: 1700000000,
		});
	});

	it('leaves out a commit with no change line for the file, such as a merge', () => {
		const output = `${header('d'.repeat(40), "Merge branch 'x'")}\n\n${header('a'.repeat(40), 'add')}\n\nA\tf.ts\n`;
		expect(parseFileHistory(output).map((entry) => entry.subject)).toEqual(['add']);
	});

	it('keeps a subject with a pipe in it', () => {
		const output = `${header('a'.repeat(40), 'fix: a | b')}\n\nM\tf.ts\n`;
		expect(parseFileHistory(output)[0].subject).toBe('fix: a | b');
	});
});

describe('parseBlame', () => {
	const A = 'a'.repeat(40);
	const B = 'b'.repeat(40);
	const output = [
		`${A} 1 1 2`,
		'author Ada',
		'author-time 1700000000',
		'summary first',
		'filename f.ts',
		'\tline one',
		`${A} 2 2`,
		'\tline two',
		`${B} 3 3 1`,
		'author Grace',
		'author-time 1700000100',
		'summary second',
		'filename f.ts',
		'\t\tindented',
		'',
	].join('\n');

	it('attributes every line, carrying the details of a commit already seen', () => {
		const blame = parseBlame(output);
		expect(blame.listLines).toEqual(['line one', 'line two', '\tindented']);
		expect(blame.listLineHashes).toEqual([A, A, B]);
		expect(blame.mapCommits[A]).toEqual({
			author: 'Ada',
			authoredAt: 1700000000,
			summary: 'first',
		});
		expect(blame.mapCommits[B].author).toBe('Grace');
	});
});
