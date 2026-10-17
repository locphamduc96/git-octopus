import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RefPanelData } from '@git-octopus/shared';
import type { RefPanelItem } from '../../features/ref-panel/refPanelModel';

async function load() {
	vi.stubGlobal('acquireVsCodeApi', () => ({
		postMessage: () => {},
		getState: () => undefined,
		setState: () => undefined,
	}));
	vi.resetModules();
	const { refPanel } = await import('./refPanel.svelte');
	const { dispatchHostMessage } = await import('../hostRouter');
	return { refPanel, dispatchHostMessage };
}

const DATA: RefPanelData = {
	listLocal: [{ name: 'main', hash: 'a'.repeat(40) }],
	listRemote: [],
	listTags: [],
	listStashes: [],
	current: 'main',
};

describe('ref panel store', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('holds nothing before the host sends the refs', async () => {
		const { refPanel } = await load();
		expect(refPanel.data).toBeNull();
		expect(refPanel.repoPath).toBeNull();
	});

	it('keeps the latest refs and the repository they belong to', async () => {
		const { refPanel, dispatchHostMessage } = await load();

		expect(dispatchHostMessage({ type: 'refPanel', repoPath: '/repo/a', data: DATA })).toBe(true);
		expect(refPanel.data).toEqual(DATA);
		expect(refPanel.repoPath).toBe('/repo/a');

		const next = { ...DATA, current: null };
		dispatchHostMessage({ type: 'refPanel', repoPath: '/repo/b', data: next });
		expect(refPanel.data).toEqual(next);
		expect(refPanel.repoPath).toBe('/repo/b');
	});
});

function item(over: Partial<RefPanelItem>): RefPanelItem {
	return {
		kind: 'local',
		name: 'main',
		hash: 'a'.repeat(40),
		label: 'main',
		detail: null,
		current: false,
		hidden: false,
		remote: null,
		...over,
	};
}

const WIDE: RefPanelData = {
	listLocal: [
		{ name: 'main', hash: 'a'.repeat(40) },
		{ name: 'feature/x', hash: 'b'.repeat(40) },
	],
	listRemote: [
		{ name: 'origin/main', hash: 'a'.repeat(40), remote: 'origin' },
		{ name: 'team/origin/feature/x', hash: 'b'.repeat(40), remote: 'team/origin' },
		{ name: 'origin/only', hash: 'c'.repeat(40), remote: 'origin' },
	],
	listTags: [{ name: 'v1', hash: 'a'.repeat(40) }],
	listStashes: [{ selector: 'stash@{0}', hash: 'd'.repeat(40), message: 'WIP on main' }],
	current: 'main',
};

describe('chipForItem', () => {
	it('gives a local branch the remotes that carry the same name and its tracking', async () => {
		vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage() {}, getState() {}, setState() {} }));
		const { chipForItem } = await import('./refPanel.svelte');
		const tracking = { upstream: 'origin/main', ahead: 1, behind: 0, gone: false };
		const chip = chipForItem(item({ name: 'main', current: true }), WIDE, { main: tracking });
		expect(chip).toMatchObject({
			kind: 'branch',
			name: 'main',
			checkedOut: true,
			hasLocal: true,
			listRemotes: ['origin'],
			tracking,
		});
		expect(chipForItem(item({ name: 'feature/x' }), WIDE, {})?.listRemotes).toEqual([
			'team/origin',
		]);
	});

	it('gives a remote row that remote ref alone, cutting a remote name that holds a slash', async () => {
		vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage() {}, getState() {}, setState() {} }));
		const { chipForItem } = await import('./refPanel.svelte');
		const chip = chipForItem(
			item({ kind: 'remote', name: 'team/origin/feature/x', remote: 'team/origin' }),
			WIDE,
			{}
		);
		expect(chip).toMatchObject({
			name: 'feature/x',
			hasLocal: false,
			listRemotes: ['team/origin'],
		});
	});

	it('turns tags and stashes into their chips and leaves worktrees and submodules out', async () => {
		vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage() {}, getState() {}, setState() {} }));
		const { chipForItem } = await import('./refPanel.svelte');
		expect(chipForItem(item({ kind: 'tag', name: 'v1' }), WIDE, {})?.kind).toBe('tag');
		expect(chipForItem(item({ kind: 'stash', name: 'stash@{0}' }), WIDE, {})?.kind).toBe('stash');
		expect(chipForItem(item({ kind: 'worktree', name: '/w' }), WIDE, {})).toBeNull();
		expect(chipForItem(item({ kind: 'submodule', name: '/s' }), WIDE, {})).toBeNull();
	});
});

describe('commitForItem', () => {
	it('keeps the commit the graph loaded and adds the stash a stash row stands for', async () => {
		vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage() {}, getState() {}, setState() {} }));
		const { commitForItem } = await import('./refPanel.svelte');
		const loaded = {
			hash: 'd'.repeat(40),
			parents: [],
			author: { name: 'a', email: 'a@x' },
			committedAt: 1,
			authoredAt: 1,
			subject: 'WIP on main',
			refs: [],
		};
		expect(commitForItem(item({ kind: 'local' }), loaded)).toBe(loaded);
		const stash = commitForItem(item({ kind: 'stash', name: 'stash@{0}' }), loaded);
		expect(stash.refs).toEqual([{ kind: 'stash', name: 'stash@{0}' }]);
	});

	it('stands in for a commit the graph has not loaded', async () => {
		vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage() {}, getState() {}, setState() {} }));
		const { commitForItem } = await import('./refPanel.svelte');
		const commit = commitForItem(
			item({ kind: 'stash', name: 'stash@{1}', detail: 'wip' }),
			undefined
		);
		expect(commit).toMatchObject({ hash: 'a'.repeat(40), subject: 'wip' });
		expect(commit.refs).toEqual([{ kind: 'stash', name: 'stash@{1}' }]);
	});
});

describe('toggleHiddenRef', () => {
	const none = { listBranches: [], listRemotes: [], listTags: [] };

	it('hides a row in the list that holds its kind and shows it again', async () => {
		vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage() {}, getState() {}, setState() {} }));
		const { toggleHiddenRef } = await import('./refPanel.svelte');
		const local = toggleHiddenRef(item({ kind: 'local', name: 'dev' }), none);
		expect(local).toEqual({ ...none, listBranches: ['dev'] });
		expect(toggleHiddenRef(item({ kind: 'local', name: 'dev' }), local)).toEqual(none);
		expect(toggleHiddenRef(item({ kind: 'remote', name: 'origin/dev' }), none).listRemotes).toEqual(
			['origin/dev']
		);
		expect(toggleHiddenRef(item({ kind: 'tag', name: 'v1' }), none).listTags).toEqual(['v1']);
	});

	it('leaves the list alone for a row that cannot be hidden', async () => {
		vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage() {}, getState() {}, setState() {} }));
		const { toggleHiddenRef } = await import('./refPanel.svelte');
		expect(toggleHiddenRef(item({ kind: 'stash', name: 'stash@{0}' }), none)).toBe(none);
	});
});
