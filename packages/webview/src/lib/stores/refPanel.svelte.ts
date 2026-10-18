import type { Commit, HiddenRefs, RefPanelData, UpstreamTracking } from '@git-octopus/shared';
import type { RefPanelItem } from '../../features/ref-panel/refPanelModel';
import type { RefChip } from '../graphChips';
import { onHostType } from '../hostRouter';

let currentData = $state<RefPanelData | null>(null);
let currentRepoPath = $state<string | null>(null);

onHostType('refPanel', ({ repoPath, data }) => {
	currentRepoPath = repoPath;
	currentData = data;
});

/** The side panel's refs as the host last sent them; `null` until the first `refPanel` arrives. */
export const refPanel = {
	get data(): RefPanelData | null {
		return currentData;
	},
	get repoPath(): string | null {
		return currentRepoPath;
	},
};

/**
 * The chip the graph would draw for a panel row, so the ref menu, the checkout and the drag that
 * belong to a chip can serve the row unchanged. A remote row stands for that remote ref alone
 * (`hasLocal` false): the menu then speaks only about it.
 */
export function chipForItem(
	item: RefPanelItem,
	data: RefPanelData,
	mapTracking: Record<string, UpstreamTracking | null>
): RefChip | null {
	if (item.kind === 'local') {
		return {
			kind: 'branch',
			name: item.name,
			checkedOut: item.current,
			hasLocal: true,
			listRemotes: data.listRemote
				.filter((ref) => ref.name === `${ref.remote}/${item.name}` && ref.hash === item.hash)
				.map((ref) => ref.remote),
			title: item.name,
			tracking: mapTracking[item.name] ?? null,
		};
	}
	if (item.kind === 'remote' && item.remote) {
		return {
			kind: 'branch',
			name: item.name.slice(item.remote.length + 1),
			checkedOut: false,
			hasLocal: false,
			listRemotes: [item.remote],
			title: item.name,
			tracking: null,
		};
	}
	if (item.kind === 'tag' || item.kind === 'stash') {
		return {
			kind: item.kind,
			name: item.name,
			checkedOut: false,
			hasLocal: false,
			listRemotes: [],
			title: item.name,
			tracking: null,
		};
	}
	return null;
}

/**
 * The commit a ref action is sent against: the one the graph holds when it is loaded, otherwise a
 * stand-in carrying only what the host reads (hash, subject, the stash a row stands for).
 */
export function commitForItem(item: RefPanelItem, loaded: Commit | undefined): Commit {
	const base: Commit = loaded ?? {
		hash: item.hash ?? '',
		parents: [],
		author: { name: '', email: '' },
		committedAt: 0,
		authoredAt: 0,
		subject: item.detail ?? item.label,
		refs: [],
	};
	if (item.kind !== 'stash') return base;
	return { ...base, refs: [...base.refs, { kind: 'stash', name: item.name }] };
}

/** `hidden` with the row's ref left out of the graph, or brought back when it already is. */
export function toggleHiddenRef(item: RefPanelItem, hidden: HiddenRefs): HiddenRefs {
	const mapHiddenField: Partial<Record<RefPanelItem['kind'], keyof HiddenRefs>> = {
		local: 'listBranches',
		remote: 'listRemotes',
		tag: 'listTags',
	};
	const field = mapHiddenField[item.kind];
	if (!field) return hidden;
	const listCurrent = hidden[field];
	return {
		...hidden,
		[field]: listCurrent.includes(item.name)
			? listCurrent.filter((name) => name !== item.name)
			: [...listCurrent, item.name],
	};
}
