import { describe, expect, it } from 'vitest';
import { parseCommitPlan } from './planParser.js';

const LIST_PATHS = ['src/a.ts', 'src/b.ts', 'assets/hero.png', 'assets/hero.png.meta'];

function plan(groups: unknown, single?: unknown): string {
	return JSON.stringify({ groups, single });
}

describe('parseCommitPlan', () => {
	it('accepts a clean plan and keeps its grouping', () => {
		const result = parseCommitPlan(
			plan(
				[
					{ files: ['src/a.ts', 'src/b.ts'], subject: 'feat: add thing', body: 'why' },
					{ files: ['assets/hero.png', 'assets/hero.png.meta'], subject: 'chore: art' },
				],
				{ subject: 'feat: everything' }
			),
			LIST_PATHS
		);
		expect(result.plan?.listGroups).toHaveLength(2);
		expect(result.plan?.listGroups[0]).toEqual({
			listFiles: ['src/a.ts', 'src/b.ts'],
			subject: 'feat: add thing',
			body: 'why',
		});
		expect(result.plan?.single.subject).toBe('feat: everything');
	});

	it('unwraps markdown fences and surrounding prose', () => {
		const raw =
			'Here you go:\n```json\n' +
			plan([{ files: LIST_PATHS, subject: 'feat: x' }], { subject: 'feat: x' }) +
			'\n```\nDone!';
		expect(parseCommitPlan(raw, LIST_PATHS).plan?.listGroups[0].listFiles).toEqual(LIST_PATHS);
	});

	it('drops invented files and folds forgotten ones into the last group', () => {
		const result = parseCommitPlan(
			plan(
				[
					{ files: ['src/a.ts', 'src/made-up.ts'], subject: 'feat: a' },
					{ files: ['assets/hero.png', 'assets/hero.png.meta'], subject: 'chore: art' },
				],
				{ subject: 's' }
			),
			LIST_PATHS
		);
		const listAll = result.plan?.listGroups.flatMap((group) => group.listFiles).sort();
		expect(listAll).toEqual([...LIST_PATHS].sort());
		expect(result.plan?.listGroups[1].listFiles).toContain('src/b.ts');
	});

	it('pulls a .meta back to the group that carries its owner file', () => {
		const result = parseCommitPlan(
			plan(
				[
					{ files: ['assets/hero.png'], subject: 'chore: art' },
					{ files: ['assets/hero.png.meta', 'src/a.ts', 'src/b.ts'], subject: 'feat: code' },
				],
				{ subject: 's' }
			),
			LIST_PATHS
		);
		expect(result.plan?.listGroups[0].listFiles).toEqual(['assets/hero.png', 'assets/hero.png.meta']);
		expect(result.plan?.listGroups[1].listFiles).not.toContain('assets/hero.png.meta');
	});

	it('falls back to one group of everything when only a single message came back', () => {
		const result = parseCommitPlan(plan([], { subject: 'feat: all of it' }), LIST_PATHS);
		expect(result.plan?.listGroups).toHaveLength(1);
		expect(result.plan?.listGroups[0].listFiles.sort()).toEqual([...LIST_PATHS].sort());
	});

	it('reports non-JSON and unusable answers as errors, not empty plans', () => {
		expect(parseCommitPlan('I could not decide.', LIST_PATHS).error).toBeTruthy();
		expect(parseCommitPlan('{"groups": "what"}', LIST_PATHS).error).toBeTruthy();
	});
});
