import type { HiddenRefs, RepoInfo, WorktreeInfo } from '@git-octopus/shared';

/*
 * Structurally identical to the types `@git-octopus/shared` gains with the ref-panel messages;
 * the wiring step swaps these declarations for that import.
 */
export interface RefPanelRef {
	name: string;
	hash: string;
}
export interface RefPanelRemoteRef extends RefPanelRef {
	remote: string;
}
export interface RefPanelStash {
	selector: string;
	hash: string;
	message: string;
}
export interface RefPanelData {
	listLocal: RefPanelRef[];
	listRemote: RefPanelRemoteRef[];
	listTags: RefPanelRef[];
	listStashes: RefPanelStash[];
	current: string | null;
}

export type RefPanelKind = 'local' | 'remote' | 'tag' | 'stash' | 'worktree' | 'submodule';
export type RefPanelSectionId =
	'local' | 'remote' | 'tags' | 'stashes' | 'worktrees' | 'submodules';

/** What every event of the panel carries: the thing that was clicked, dragged or right-clicked. */
export interface RefPanelItem {
	kind: RefPanelKind;
	/**
	 * What identifies it to git or the host: the full ref name (`origin/feature/x`), the stash
	 * selector, or the folder path of a worktree or submodule.
	 */
	name: string;
	/** The commit it points at; null for a submodule, which has no commit in this repository. */
	hash: string | null;
	/** What the row shows: the last path segment of a ref name, the folder name of a worktree. */
	label: string;
	/** Secondary text: a stash message, the branch a worktree has out, a submodule's path. */
	detail: string | null;
	/** The checked-out branch, or the worktree this window has open. */
	current: boolean;
	/** The ref is left out of the graph. */
	hidden: boolean;
	/** The remote a remote-tracking branch belongs to. */
	remote: string | null;
}

export interface RefPanelFolderNode {
	type: 'folder';
	/** Collapse key, unique across the panel. */
	key: string;
	name: string;
	/** Items below this folder, at any depth. */
	count: number;
	listChildren: RefPanelNode[];
}
export interface RefPanelItemNode {
	type: 'item';
	key: string;
	item: RefPanelItem;
}
export type RefPanelNode = RefPanelFolderNode | RefPanelItemNode;

export interface RefPanelSection {
	id: RefPanelSectionId;
	/** Also the collapse key of the section. */
	key: string;
	title: string;
	/** Items shown, after the filter. */
	count: number;
	listNodes: RefPanelNode[];
}

export interface RefPanelInput {
	data: RefPanelData;
	listWorktrees: WorktreeInfo[];
	listSubmodules: RepoInfo[];
	hidden: HiddenRefs;
	filter: string;
}

export const EMPTY_REF_PANEL_DATA: RefPanelData = {
	listLocal: [],
	listRemote: [],
	listTags: [],
	listStashes: [],
	current: null,
};

interface FolderDraft {
	mapFolders: Map<string, FolderDraft>;
	listItems: RefPanelItem[];
}

function lastSegment(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

function matches(item: RefPanelItem, needle: string): boolean {
	if (needle === '') return true;
	return (
		item.name.toLowerCase().includes(needle) ||
		(item.detail?.toLowerCase().includes(needle) ?? false)
	);
}

function byName(a: { name: string }, b: { name: string }): number {
	return a.name.localeCompare(b.name);
}

/**
 * Groups items into folders by the `/` in `pathOf(item)`, folders first. A folder's key is
 * `keyBase` plus its path; `keyBase` carries a `:` that no ref name can hold, so a folder key never
 * equals an item key or a remote group key, and the base keeps folders of different remotes apart.
 */
function toFolderNodes(
	listItems: RefPanelItem[],
	keyBase: string,
	pathOf: (item: RefPanelItem) => string
): RefPanelNode[] {
	const root: FolderDraft = { mapFolders: new Map(), listItems: [] };
	for (const item of listItems) {
		const listSegments = pathOf(item).split('/');
		listSegments.pop();
		let folder = root;
		for (const segment of listSegments) {
			let next = folder.mapFolders.get(segment);
			if (!next) {
				next = { mapFolders: new Map(), listItems: [] };
				folder.mapFolders.set(segment, next);
			}
			folder = next;
		}
		folder.listItems.push(item);
	}
	return draftToNodes(root, keyBase, [], pathOf);
}

function countOf(listNodes: RefPanelNode[]): number {
	let total = 0;
	for (const node of listNodes) total += node.type === 'item' ? 1 : node.count;
	return total;
}

function draftToNodes(
	draft: FolderDraft,
	keyBase: string,
	listPrefix: string[],
	pathOf: (item: RefPanelItem) => string
): RefPanelNode[] {
	const listFolders: RefPanelNode[] = [...draft.mapFolders.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, child]) => {
			const listPath = [...listPrefix, name];
			const listChildren = draftToNodes(child, keyBase, listPath, pathOf);
			return {
				type: 'folder',
				key: `${keyBase}${listPath.join('/')}`,
				name,
				count: countOf(listChildren),
				listChildren,
			};
		});
	const listLeaves: RefPanelNode[] = [...draft.listItems]
		.sort((a, b) => lastSegment(pathOf(a)).localeCompare(lastSegment(pathOf(b))))
		.map((item) => ({ type: 'item', key: `${item.kind}:${item.name}`, item }));
	return [...listFolders, ...listLeaves];
}

function section(id: RefPanelSectionId, title: string, listNodes: RefPanelNode[]): RefPanelSection {
	return { id, key: id, title, count: countOf(listNodes), listNodes };
}

function flatNodes(listItems: RefPanelItem[]): RefPanelNode[] {
	return listItems.map((item) => ({ type: 'item', key: `${item.kind}:${item.name}`, item }));
}

function folderOf(path: string): string {
	return lastSegment(path.replace(/\/+$/, ''));
}

/**
 * The panel's sections for the current filter. A filter keeps every item that matches (case
 * insensitively, on its full name or detail) together with the folders and groups above it; a
 * section nothing matches in is dropped, and the counts are those of what is left.
 */
export function buildRefPanel(input: RefPanelInput): RefPanelSection[] {
	const { data, hidden } = input;
	const needle = input.filter.trim().toLowerCase();
	const filtering = needle !== '';
	const setHiddenBranches = new Set(hidden.listBranches);
	const setHiddenRemotes = new Set(hidden.listRemotes);
	const setHiddenTags = new Set(hidden.listTags);

	const listLocal = [...data.listLocal].sort(byName).map((ref): RefPanelItem => ({
		kind: 'local',
		name: ref.name,
		hash: ref.hash,
		label: lastSegment(ref.name),
		detail: null,
		current: ref.name === data.current,
		hidden: setHiddenBranches.has(ref.name),
		remote: null,
	}));
	const listRemote = [...data.listRemote].sort(byName).map((ref): RefPanelItem => ({
		kind: 'remote',
		name: ref.name,
		hash: ref.hash,
		label: lastSegment(ref.name),
		detail: null,
		current: false,
		hidden: setHiddenRemotes.has(ref.name),
		remote: ref.remote,
	}));
	const listTags = [...data.listTags].sort(byName).map((ref): RefPanelItem => ({
		kind: 'tag',
		name: ref.name,
		hash: ref.hash,
		label: lastSegment(ref.name),
		detail: null,
		current: false,
		hidden: setHiddenTags.has(ref.name),
		remote: null,
	}));
	const listStashes = data.listStashes.map((stash): RefPanelItem => ({
		kind: 'stash',
		name: stash.selector,
		hash: stash.hash,
		label: stash.selector,
		detail: stash.message,
		current: false,
		hidden: false,
		remote: null,
	}));
	const listWorktreeItems = input.listWorktrees.map((worktree): RefPanelItem => ({
		kind: 'worktree',
		name: worktree.path,
		hash: worktree.head,
		label: folderOf(worktree.path),
		detail: worktree.branch ?? (worktree.head === null ? 'bare' : 'detached'),
		current: worktree.isCurrent,
		hidden: false,
		remote: null,
	}));
	const listSubmoduleItems = [...input.listSubmodules].sort(byName).map((repo): RefPanelItem => ({
		kind: 'submodule',
		name: repo.path,
		hash: null,
		label: repo.name,
		detail: repo.subPath ?? null,
		current: false,
		hidden: false,
		remote: null,
	}));

	const keep = (listItems: RefPanelItem[]): RefPanelItem[] =>
		filtering ? listItems.filter((item) => matches(item, needle)) : listItems;

	const listRemoteKept = keep(listRemote);
	const listRemoteGroups: RefPanelNode[] = [
		...new Set(listRemoteKept.map((item) => item.remote ?? '')),
	]
		.sort((a, b) => a.localeCompare(b))
		.map((remote) => {
			const listOfRemote = listRemoteKept.filter((item) => item.remote === remote);
			const listChildren = toFolderNodes(listOfRemote, `remote:folder:${remote}:`, (item) =>
				item.name.slice(remote.length + 1)
			);
			return {
				type: 'folder' as const,
				key: `remote:group:${remote}`,
				name: remote,
				count: countOf(listChildren),
				listChildren,
			};
		});

	const listSections = [
		section(
			'local',
			'Local',
			toFolderNodes(keep(listLocal), 'local:folder:', (item) => item.name)
		),
		section('remote', 'Remote', listRemoteGroups),
		section(
			'tags',
			'Tags',
			toFolderNodes(keep(listTags), 'tags:folder:', (item) => item.name)
		),
		section('stashes', 'Stashes', flatNodes(keep(listStashes))),
		section('worktrees', 'Worktrees', flatNodes(keep(listWorktreeItems))),
		section('submodules', 'Submodules', flatNodes(keep(listSubmoduleItems))),
	];

	const setAlwaysShown = new Set<RefPanelSectionId>(['local', 'remote', 'tags']);
	return listSections.filter(
		(entry) => entry.count > 0 || (!filtering && setAlwaysShown.has(entry.id))
	);
}

export interface RefPanelSectionRow {
	type: 'section';
	key: string;
	depth: 0;
	title: string;
	count: number;
	expanded: boolean;
}
export interface RefPanelFolderRow {
	type: 'folder';
	key: string;
	depth: number;
	name: string;
	count: number;
	expanded: boolean;
	isRemote: boolean;
}
export interface RefPanelItemRow {
	type: 'item';
	key: string;
	depth: number;
	item: RefPanelItem;
}
export type RefPanelRow = RefPanelSectionRow | RefPanelFolderRow | RefPanelItemRow;

/**
 * The rows on screen, top to bottom. A filter opens everything it matched in, whatever was
 * collapsed, so a result is never hidden behind a folder the user shut earlier.
 */
export function flattenRefPanel(
	listSections: RefPanelSection[],
	setCollapsed: ReadonlySet<string>,
	filtering: boolean
): RefPanelRow[] {
	const listRows: RefPanelRow[] = [];
	const isOpen = (key: string): boolean => filtering || !setCollapsed.has(key);

	const walk = (listNodes: RefPanelNode[], depth: number): void => {
		for (const node of listNodes) {
			if (node.type === 'item') {
				listRows.push({ type: 'item', key: node.key, depth, item: node.item });
				continue;
			}
			const expanded = isOpen(node.key);
			listRows.push({
				type: 'folder',
				key: node.key,
				depth,
				name: node.name,
				count: node.count,
				expanded,
				isRemote: depth === 1 && node.key.startsWith('remote:group:'),
			});
			if (expanded) walk(node.listChildren, depth + 1);
		}
	};

	for (const entry of listSections) {
		const expanded = isOpen(entry.key);
		listRows.push({
			type: 'section',
			key: entry.key,
			depth: 0,
			title: entry.title,
			count: entry.count,
			expanded,
		});
		if (expanded) walk(entry.listNodes, 1);
	}
	return listRows;
}
