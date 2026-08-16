import { describe, expect, it } from 'vitest';
import type { Ref } from '@git-octopus/shared';
import { buildChips, splitChips } from './graphChips';

const local = (name: string): Ref => ({ kind: 'branch', name });
const remote = (name: string, from: string): Ref => ({ kind: 'branch', name, remote: from });

describe('buildChips', () => {
	it('merges a branch that exists locally and on remotes into one chip', () => {
		const listChips = buildChips([local('main'), remote('main', 'origin')], null, null);
		expect(listChips).toHaveLength(1);
		expect(listChips[0]).toMatchObject({ name: 'main', hasLocal: true, listRemotes: ['origin'] });
	});

	it('keeps one chip per remote name in the merged chip', () => {
		const [chip] = buildChips(
			[local('main'), remote('main', 'origin'), remote('main', 'upstream')],
			null,
			null
		);
		expect(chip.listRemotes).toEqual(['origin', 'upstream']);
	});

	it('drops the standalone HEAD ref, which the tick on the branch already says', () => {
		const listChips = buildChips([{ kind: 'head' }, local('main')], 'main', null);
		expect(listChips).toHaveLength(1);
		expect(listChips[0].checkedOut).toBe(true);
	});

	it('marks a branch checked out only when it is the local one', () => {
		// A remote-tracking ref of the checked-out name is not what HEAD points at.
		const [chip] = buildChips([remote('main', 'origin')], 'main', null);
		expect(chip.checkedOut).toBe(false);
	});

	it('orders stash first, then branches, then tags', () => {
		const listChips = buildChips(
			[{ kind: 'tag', name: 'v1' }, local('dev'), { kind: 'stash', name: 'stash@{0}' }],
			null,
			null
		);
		expect(listChips.map((chip) => chip.kind)).toEqual(['stash', 'branch', 'tag']);
	});

	it('ranks checked out, then last picked, then local, then remote-only', () => {
		const listChips = buildChips(
			[remote('remote-only', 'origin'), local('other'), local('picked'), local('current')],
			'current',
			'picked'
		);
		expect(listChips.map((chip) => chip.name)).toEqual([
			'current',
			'picked',
			'other',
			'remote-only',
		]);
	});

	it('describes what a chip stands for in its tooltip', () => {
		const [chip] = buildChips([local('main'), remote('main', 'origin')], 'main', null);
		expect(chip.title).toBe('main — checked out, origin/main');
	});

	it('says "local branch" when the branch is not the checked-out one', () => {
		const [chip] = buildChips([local('dev')], 'main', null);
		expect(chip.title).toBe('dev — local branch');
	});
});

describe('splitChips', () => {
	it('keeps the first branch chip visible and folds the rest away', () => {
		const listChips = buildChips([local('a'), local('b'), local('c')], null, null);
		const groups = splitChips(listChips);
		expect(groups.listVisible.map((chip) => chip.name)).toEqual(['a']);
		expect(groups.listOverflow.map((chip) => chip.name)).toEqual(['b', 'c']);
	});

	it('never folds tags or stashes, which have no `+N` of their own', () => {
		const listChips = buildChips(
			[local('a'), local('b'), { kind: 'tag', name: 'v1' }, { kind: 'stash', name: 's' }],
			null,
			null
		);
		const groups = splitChips(listChips);
		expect(groups.listVisible.map((chip) => chip.kind)).toEqual(['stash', 'branch', 'tag']);
		expect(groups.listOverflow.map((chip) => chip.name)).toEqual(['b']);
	});

	it('folds nothing when a commit carries a single branch', () => {
		expect(splitChips(buildChips([local('a')], null, null)).listOverflow).toEqual([]);
	});
});
