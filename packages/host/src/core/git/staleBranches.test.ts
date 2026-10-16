import { describe, expect, it } from 'vitest';
import { parseBranchInventory, parseMergedBranches } from './staleBranches';

const SHA = 'a'.repeat(40);
const DATE = '2026-01-02T03:04:05+07:00';

function line(fields: (string | undefined)[]): string {
	return fields.map((field) => field ?? '').join('\0');
}

describe('parseBranchInventory', () => {
	it('reads name, hash, date, subject and the checked-out marker', () => {
		const output = [
			line(['main', SHA, DATE, '*', '', 'Fix the thing']),
			line(['feature/x', SHA, DATE, '', '', 'Add the other thing']),
		].join('\n');
		const listEntries = parseBranchInventory(output, new Set());
		expect(listEntries).toEqual([
			{
				name: 'main',
				hash: SHA,
				subject: 'Fix the thing',
				committedAt: DATE,
				merged: false,
				upstreamGone: false,
				current: true,
			},
			{
				name: 'feature/x',
				hash: SHA,
				subject: 'Add the other thing',
				committedAt: DATE,
				merged: false,
				upstreamGone: false,
				current: false,
			},
		]);
	});

	it('flags a branch whose upstream was deleted', () => {
		const output = [
			line(['gone-branch', SHA, DATE, '', '[gone]', 'Subject']),
			line(['behind-branch', SHA, DATE, '', '[behind 3]', 'Subject']),
		].join('\n');
		const listEntries = parseBranchInventory(output, new Set());
		expect(listEntries.map((entry) => entry.upstreamGone)).toEqual([true, false]);
	});

	it('marks branches present in the merged set', () => {
		const output = [
			line(['done', SHA, DATE, '', '', 'Subject']),
			line(['wip', SHA, DATE, '', '', 'Subject']),
		].join('\n');
		const listEntries = parseBranchInventory(output, new Set(['done']));
		expect(listEntries.map((entry) => entry.merged)).toEqual([true, false]);
	});

	it('keeps a subject that itself contains the field delimiter', () => {
		const output = line(['weird', SHA, DATE, '', '', 'before\0after']);
		expect(parseBranchInventory(output, new Set())[0].subject).toBe('before\0after');
	});

	it('returns nothing for an empty repository', () => {
		expect(parseBranchInventory('', new Set())).toEqual([]);
	});
});

describe('parseMergedBranches', () => {
	it('strips the current-branch marker and surrounding whitespace', () => {
		const setMerged = parseMergedBranches('* main\n  feature/x\n+ worktree-branch\n');
		expect([...setMerged]).toEqual(['main', 'feature/x', 'worktree-branch']);
	});

	it('ignores the detached-HEAD pseudo entry', () => {
		const setMerged = parseMergedBranches('* (HEAD detached at abc1234)\n  main\n');
		expect([...setMerged]).toEqual(['main']);
	});
});
