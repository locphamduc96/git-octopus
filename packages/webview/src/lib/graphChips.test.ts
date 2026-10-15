import { describe, expect, it } from 'vitest';
import type { Ref, UpstreamTracking } from '@git-octopus/shared';
import {
	buildChips,
	chipRef,
	chipRemote,
	isDropTarget,
	splitChips,
	trackingSummary,
} from './graphChips';

const track = (over: Partial<UpstreamTracking> = {}): UpstreamTracking => ({
	upstream: 'origin/main',
	ahead: 0,
	behind: 0,
	gone: false,
	...over,
});

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

	it('gives detached HEAD a chip of its own, since no branch carries the tick', () => {
		const listChips = buildChips([{ kind: 'head' }, local('main')], null, null);
		expect(listChips.map((chip) => chip.kind)).toEqual(['head', 'branch']);
		expect(listChips[0]).toMatchObject({ name: 'HEAD', checkedOut: false });
	});

	it('leads with the HEAD chip while detached', () => {
		// It is the one thing on the row a reader is hunting for; a tag ahead of it buries it.
		const listChips = buildChips(
			[{ kind: 'tag', name: 'v1' }, { kind: 'stash', name: 'stash@{0}' }, { kind: 'head' }],
			null,
			null
		);
		expect(listChips[0].kind).toBe('head');
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

describe('chipRef / chipRemote', () => {
	it('hands git the bare name for a local branch', () => {
		const [chip] = buildChips([local('main'), remote('main', 'origin')], null, null);
		expect(chipRef(chip)).toEqual({ ref: 'main', label: 'main' });
	});

	it('hands git the full ref path for a remote-only branch, and the short label to read', () => {
		const [chip] = buildChips([remote('main', 'origin')], null, null);
		expect(chipRemote(chip)).toEqual({ remote: 'origin', branch: 'main' });
		expect(chipRef(chip)).toEqual({ ref: 'refs/remotes/origin/main', label: 'origin/main' });
	});

	it('answers null for a chip that stands for no branch ref', () => {
		const [chip] = buildChips([{ kind: 'tag', name: 'v1' }], null, null);
		expect(chipRemote(chip)).toBeNull();
		expect(chipRef(chip)).toBeNull();
	});
});

describe('isDropTarget', () => {
	const [localChip] = buildChips([local('main')], null, null);
	const [remoteChip] = buildChips([remote('main', 'origin')], null, null);
	const [tagChip] = buildChips([{ kind: 'tag', name: 'v1' }], null, null);

	it('accepts only a local branch other than the one being dragged', () => {
		expect(isDropTarget(localChip, 'feature')).toBe(true);
		expect(isDropTarget(localChip, 'main')).toBe(false);
	});

	it('refuses while nothing is dragged, and refuses a tag', () => {
		expect(isDropTarget(localChip, null)).toBe(false);
		expect(isDropTarget(tagChip, 'feature')).toBe(false);
	});

	it('accepts a remote-only branch, but never the chip being dragged', () => {
		expect(isDropTarget(remoteChip, 'feature')).toBe(true);
		expect(isDropTarget(remoteChip, 'origin/main')).toBe(false);
	});
});

describe('buildChips tracking', () => {
	it('attaches the upstream drift of a local branch', () => {
		const [chip] = buildChips([local('main')], null, null, { main: track({ behind: 12 }) });
		expect(chip.tracking).toEqual(track({ behind: 12 }));
	});

	it('leaves a remote-only chip without tracking, even when the map knows the name', () => {
		const [chip] = buildChips([remote('main', 'origin')], null, null, {
			main: track({ behind: 12 }),
		});
		expect(chip.tracking).toBeNull();
	});

	it('attaches tracking to the local half of a combined chip', () => {
		const [chip] = buildChips([local('main'), remote('main', 'origin')], null, null, {
			main: track({ ahead: 1, behind: 2 }),
		});
		expect(chip.tracking).toEqual(track({ ahead: 1, behind: 2 }));
	});

	it('leaves a branch the map says nothing about without tracking', () => {
		const [chip] = buildChips([local('dev')], null, null, { main: track({ behind: 12 }) });
		expect(chip.tracking).toBeNull();
	});

	it('never attaches tracking to a tag or a stash', () => {
		const listChips = buildChips(
			[
				{ kind: 'tag', name: 'v1' },
				{ kind: 'stash', name: 's' },
			],
			null,
			null,
			{
				v1: track(),
				s: track(),
			}
		);
		expect(listChips.map((chip) => chip.tracking)).toEqual([null, null]);
	});

	it('puts the drift into the chip tooltip', () => {
		const [chip] = buildChips([local('main')], 'main', null, { main: track({ behind: 12 }) });
		expect(chip.title).toBe('main — checked out, 12 behind origin/main — as of your last fetch');
	});

	it('leaves the tooltip alone for a branch with no upstream', () => {
		const [chip] = buildChips([local('main')], 'main', null);
		expect(chip.title).toBe('main — checked out');
	});
});

describe('trackingSummary', () => {
	it('names the gap in both directions', () => {
		expect(trackingSummary(track({ ahead: 1, behind: 2 }))).toBe(
			'1 ahead, 2 behind origin/main — as of your last fetch'
		);
	});

	it('says in sync when there is no gap', () => {
		expect(trackingSummary(track())).toBe('in sync with origin/main — as of your last fetch');
	});

	it('says some when the count could not be read', () => {
		expect(trackingSummary(track({ behind: null }))).toBe(
			'some behind origin/main — as of your last fetch'
		);
	});

	it('reports a gone upstream without a fetch caveat, which would say nothing', () => {
		expect(trackingSummary(track({ gone: true }))).toBe('upstream origin/main is gone');
	});
});
