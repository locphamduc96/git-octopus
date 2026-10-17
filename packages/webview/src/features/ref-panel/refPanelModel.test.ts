import type { RepoInfo, WorktreeInfo } from '@git-octopus/shared';
import { describe, expect, it } from 'vitest';
import {
	buildRefPanel,
	flattenRefPanel,
	type RefPanelData,
	type RefPanelFolderNode,
	type RefPanelInput,
	type RefPanelNode,
} from './refPanelModel';

const hash = (digit: string): string => digit.repeat(40);

const data: RefPanelData = {
	listLocal: [
		{ name: 'main', hash: hash('1') },
		{ name: 'feature/b', hash: hash('2') },
		{ name: 'feature/a', hash: hash('3') },
		{ name: 'fix/deep/nest', hash: hash('4') },
	],
	listRemote: [
		{ name: 'origin/main', hash: hash('1'), remote: 'origin' },
		{ name: 'origin/feature/a', hash: hash('3'), remote: 'origin' },
		{ name: 'upstream/main', hash: hash('5'), remote: 'upstream' },
	],
	listTags: [
		{ name: 'v1.0', hash: hash('1') },
		{ name: 'rel/v2.0', hash: hash('2') },
	],
	listStashes: [{ selector: 'stash@{0}', hash: hash('6'), message: 'WIP on main: parser' }],
	current: 'feature/a',
};

const listWorktrees: WorktreeInfo[] = [
	{
		path: '/code/app',
		head: hash('1'),
		branch: 'main',
		isMain: true,
		isCurrent: true,
		locked: false,
		prunable: false,
	},
	{
		path: '/code/app-hotfix',
		head: hash('4'),
		branch: null,
		isMain: false,
		isCurrent: false,
		locked: false,
		prunable: false,
	},
];

const listSubmodules: RepoInfo[] = [
	{ path: '/code/app/vendor/lib', name: 'lib', parent: '/code/app', subPath: 'vendor/lib' },
];

function input(over: Partial<RefPanelInput> = {}): RefPanelInput {
	return {
		data,
		listWorktrees,
		listSubmodules,
		hidden: { listBranches: [], listRemotes: [], listTags: [] },
		filter: '',
		...over,
	};
}

function find(listNodes: RefPanelNode[], key: string): RefPanelNode | undefined {
	for (const node of listNodes) {
		if (node.key === key) return node;
		if (node.type === 'folder') {
			const inner = find(node.listChildren, key);
			if (inner) return inner;
		}
	}
	return undefined;
}

function names(listNodes: RefPanelNode[]): string[] {
	return listNodes.map((node) => (node.type === 'folder' ? `${node.name}/` : node.item.label));
}

describe('buildRefPanel', () => {
	it('lists the six sections in order', () => {
		const listSections = buildRefPanel(input());
		expect(listSections.map((entry) => entry.title)).toEqual([
			'Local',
			'Remote',
			'Tags',
			'Stashes',
			'Worktrees',
			'Submodules',
		]);
		expect(listSections.map((entry) => entry.count)).toEqual([4, 3, 2, 1, 2, 1]);
	});

	it('groups branches into folders by the slash, folders first', () => {
		const [local] = buildRefPanel(input());
		expect(names(local.listNodes)).toEqual(['feature/', 'fix/', 'main']);
		const feature = local.listNodes[0] as RefPanelFolderNode;
		expect(feature.key).toBe('local:folder:feature');
		expect(feature.count).toBe(2);
		expect(names(feature.listChildren)).toEqual(['a', 'b']);
		const fix = local.listNodes[1] as RefPanelFolderNode;
		expect(names(fix.listChildren)).toEqual(['deep/']);
		const nest = (fix.listChildren[0] as RefPanelFolderNode).listChildren[0];
		expect(nest.type === 'item' && nest.item.name).toBe('fix/deep/nest');
	});

	it('groups remote branches by remote, then by folder inside the branch part', () => {
		const listSections = buildRefPanel(input());
		const remote = listSections[1];
		expect(names(remote.listNodes)).toEqual(['origin/', 'upstream/']);
		const origin = remote.listNodes[0] as RefPanelFolderNode;
		expect(origin.key).toBe('remote:group:origin');
		expect(names(origin.listChildren)).toEqual(['feature/', 'main']);
		const feature = find(remote.listNodes, 'remote:folder:origin:feature') as RefPanelFolderNode;
		const item = feature.listChildren[0];
		expect(item.type === 'item' && item.item).toMatchObject({
			kind: 'remote',
			name: 'origin/feature/a',
			label: 'a',
			remote: 'origin',
			hash: hash('3'),
		});
	});

	it('shows tags in folders and stashes, worktrees and submodules flat', () => {
		const listSections = buildRefPanel(input());
		expect(names(listSections[2].listNodes)).toEqual(['rel/', 'v1.0']);
		expect(names(listSections[3].listNodes)).toEqual(['stash@{0}']);
		const stash = listSections[3].listNodes[0];
		expect(stash.type === 'item' && stash.item).toMatchObject({
			kind: 'stash',
			detail: 'WIP on main: parser',
			hash: hash('6'),
		});
		const worktree = listSections[4].listNodes[1];
		expect(worktree.type === 'item' && worktree.item).toMatchObject({
			kind: 'worktree',
			name: '/code/app-hotfix',
			label: 'app-hotfix',
			detail: 'detached',
		});
		const submodule = listSections[5].listNodes[0];
		expect(submodule.type === 'item' && submodule.item).toMatchObject({
			kind: 'submodule',
			name: '/code/app/vendor/lib',
			label: 'lib',
			detail: 'vendor/lib',
			hash: null,
		});
	});

	it('flags the checked-out branch and the worktree this window has open', () => {
		const listSections = buildRefPanel(input());
		const current = find(listSections[0].listNodes, 'local:feature/a');
		const other = find(listSections[0].listNodes, 'local:main');
		expect(current?.type === 'item' && current.item.current).toBe(true);
		expect(other?.type === 'item' && other.item.current).toBe(false);
		const open = listSections[4].listNodes[0];
		expect(open.type === 'item' && open.item.current).toBe(true);
	});

	it('flags hidden refs per kind, by the name the graph filter uses', () => {
		const listSections = buildRefPanel(
			input({
				hidden: {
					listBranches: ['main'],
					listRemotes: ['origin/main'],
					listTags: ['v1.0'],
				},
			})
		);
		const flag = (listNodes: RefPanelNode[], key: string): boolean | undefined => {
			const node = find(listNodes, key);
			return node?.type === 'item' ? node.item.hidden : undefined;
		};
		expect(flag(listSections[0].listNodes, 'local:main')).toBe(true);
		expect(flag(listSections[0].listNodes, 'local:feature/a')).toBe(false);
		expect(flag(listSections[1].listNodes, 'remote:origin/main')).toBe(true);
		expect(flag(listSections[1].listNodes, 'remote:upstream/main')).toBe(false);
		expect(flag(listSections[2].listNodes, 'tag:v1.0')).toBe(true);
	});

	it('filters without regard to case and keeps the folders above every match', () => {
		const listSections = buildRefPanel(input({ filter: 'FEATURE/A' }));
		expect(listSections.map((entry) => entry.title)).toEqual(['Local', 'Remote']);
		const [local, remote] = listSections;
		expect(names(local.listNodes)).toEqual(['feature/']);
		expect((local.listNodes[0] as RefPanelFolderNode).listChildren).toHaveLength(1);
		expect(names(remote.listNodes)).toEqual(['origin/']);
		const feature = find(remote.listNodes, 'remote:folder:origin:feature') as RefPanelFolderNode;
		expect(names(feature.listChildren)).toEqual(['a']);
	});

	it('counts what is left after the filter, per section', () => {
		const listSections = buildRefPanel(input({ filter: 'main' }));
		expect(listSections.map((entry) => [entry.title, entry.count])).toEqual([
			['Local', 1],
			['Remote', 2],
			['Stashes', 1],
			['Worktrees', 1],
		]);
		const remote = listSections[1];
		expect((remote.listNodes[0] as RefPanelFolderNode).count).toBe(1);
	});

	it('drops a section nothing matches in, and keeps the always-on ones when empty', () => {
		expect(buildRefPanel(input({ filter: 'zzz' }))).toEqual([]);
		const listSections = buildRefPanel(
			input({
				data: { ...data, listLocal: [], listRemote: [], listTags: [], listStashes: [] },
				listWorktrees: [],
				listSubmodules: [],
			})
		);
		expect(listSections.map((entry) => entry.title)).toEqual(['Local', 'Remote', 'Tags']);
	});
});

describe('flattenRefPanel', () => {
	it('lists section, folder and item rows with their depth', () => {
		const listRows = flattenRefPanel(buildRefPanel(input()), new Set(), false);
		const listLocal = listRows.slice(0, 7);
		expect(listLocal.map((row) => `${row.depth}:${row.key}`)).toEqual([
			'0:local',
			'1:local:folder:feature',
			'2:local:feature/a',
			'2:local:feature/b',
			'1:local:folder:fix',
			'2:local:folder:fix/deep',
			'3:local:fix/deep/nest',
		]);
	});

	it('leaves out what is below a collapsed section or folder', () => {
		const listRows = flattenRefPanel(
			buildRefPanel(input()),
			new Set(['local:folder:feature', 'remote', 'tags']),
			false
		);
		const listKeys = listRows.map((row) => row.key);
		expect(listKeys).toContain('local:folder:feature');
		expect(listKeys).not.toContain('local:feature/a');
		expect(listKeys).toContain('remote');
		expect(listKeys).not.toContain('remote:group:origin');
		expect(listKeys).not.toContain('tag:v1.0');
		const feature = listRows.find((row) => row.key === 'local:folder:feature');
		expect(feature?.type === 'folder' && feature.expanded).toBe(false);
	});

	it('opens everything while filtering', () => {
		const listRows = flattenRefPanel(
			buildRefPanel(input({ filter: 'feature/a' })),
			new Set(['local', 'local:folder:feature']),
			true
		);
		expect(listRows.map((row) => row.key)).toContain('local:feature/a');
	});

	it('keeps every key unique when remote names and branch folders overlap', () => {
		const listRows = flattenRefPanel(
			buildRefPanel(
				input({
					data: {
						...data,
						listRemote: [
							{ name: 'origin/feature/x', hash: hash('1'), remote: 'origin' },
							{ name: 'origin/feature/y', hash: hash('2'), remote: 'origin/feature' },
							{ name: 'origin/feature/b/z', hash: hash('3'), remote: 'origin' },
							{ name: 'origin/feature/b/z2', hash: hash('4'), remote: 'origin/feature' },
						],
					},
				})
			),
			new Set(),
			false
		);
		const listKeys = listRows.map((row) => row.key);
		expect(new Set(listKeys).size).toBe(listKeys.length);
	});

	it('marks the remote groups', () => {
		const listRows = flattenRefPanel(buildRefPanel(input()), new Set(), false);
		const origin = listRows.find((row) => row.key === 'remote:group:origin');
		const feature = listRows.find((row) => row.key === 'remote:folder:origin:feature');
		expect(origin?.type === 'folder' && origin.isRemote).toBe(true);
		expect(feature?.type === 'folder' && feature.isRemote).toBe(false);
	});
});
