import { describe, expect, it } from 'vitest';
import {
	buildExecuteGroups,
	listPlanFiles,
	moveFile,
	toEditablePlan,
	type EditablePlan,
} from './aiCommitPlan';

function plan(): EditablePlan {
	return toEditablePlan({
		listGroups: [
			{ listFiles: ['a.ts', 'b.ts'], subject: 'feat: ab', body: 'why' },
			{ listFiles: ['c.ts'], subject: 'chore: c' },
		],
		single: { subject: 'feat: all' },
	});
}

describe('toEditablePlan', () => {
	it('fills missing bodies so the dialog always binds to a string', () => {
		const editable = plan();
		expect(editable.listGroups[1].body).toBe('');
		expect(editable.single.body).toBe('');
	});
});

describe('moveFile', () => {
	it('moves a file and drops the group it emptied', () => {
		const moved = moveFile(plan(), 'c.ts', 0);
		expect(moved.listGroups).toHaveLength(1);
		expect(moved.listGroups[0].listFiles).toEqual(['a.ts', 'b.ts', 'c.ts']);
	});

	it('is a no-op onto the group the file already sits in', () => {
		const original = plan();
		expect(moveFile(original, 'a.ts', 0)).toBe(original);
	});
});

describe('buildExecuteGroups', () => {
	it('folds everything into one commit in single mode', () => {
		const built = buildExecuteGroups(plan(), 'single');
		expect(built).toEqual({
			listGroups: [{ listFiles: ['a.ts', 'b.ts', 'c.ts'], message: 'feat: all' }],
		});
	});

	it('keeps the split and joins subject and body the git way', () => {
		const built = buildExecuteGroups(plan(), 'split');
		if ('error' in built) throw new Error(built.error);
		expect(built.listGroups[0].message).toBe('feat: ab\n\nwhy');
		expect(built.listGroups[1].message).toBe('chore: c');
	});

	it('refuses a commit with no subject instead of letting git refuse it later', () => {
		const empty = plan();
		empty.listGroups[1].subject = '  ';
		expect(buildExecuteGroups(empty, 'split')).toEqual({ error: 'Commit 2 needs a subject.' });
		empty.single.subject = '';
		expect(buildExecuteGroups(empty, 'single')).toEqual({ error: 'The commit needs a subject.' });
	});
});

describe('listPlanFiles', () => {
	it('walks the groups in order', () => {
		expect(listPlanFiles(plan())).toEqual(['a.ts', 'b.ts', 'c.ts']);
	});
});
