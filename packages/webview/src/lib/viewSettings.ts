import type { CommitOrder, RepoActionId } from '@git-octopus/shared';
import { DEFAULT_AUTO_FETCH_MINUTES } from '@git-octopus/shared';
import type { FileViewMode } from './fileTree';
import type { GraphStyle } from './graphPath';
import type { DiffLayout } from './diffRows';

/**
 * Owned by `lib/graphPath`, where the behaviour lives; re-exported here so settings consumers
 * have one import for the whole settings surface. `GraphStyle` in particular must never be
 * re-declared: a re-declaration once drifted out of sync and silently dropped `'curved'` behind
 * an `as` cast.
 */
export type { GraphStyle } from './graphPath';

/** How tall a commit row is drawn — named for the space around the text, not a pixel count. */
export type RowDensity = 'compact' | 'comfortable' | 'spacious';
/** Where a file diff opens: a VS Code editor tab, or the panel in place of the graph. */
export type DiffTarget = 'editor' | 'panel';
/** How much of the file the diff panel draws. */
export type DiffMode = 'compact' | 'full';
/** Owned by `lib/diffRows`, where the two layouts are built. */
export type { DiffLayout } from './diffRows';
/** Which of a commit's two dates the Date column shows. */
export type DateType = 'commit' | 'author';

/**
 * The members of a union, at run time.
 *
 * A `<select>` hands its choice back as a plain `string` however narrowly the markup lists the
 * options, so the union has to be re-established from the value itself; asserting it instead would
 * let a stale `<option>` through as a setting nothing downstream can handle.
 *
 * Built through `membersOf` rather than `satisfies`, which only proves that every value listed is a
 * member — never that every member is listed. A union that grows a case the list forgets would make
 * that option unpickable and say nothing, which is exactly how a re-declared `GraphStyle` once lost
 * `'curved'`.
 */
function membersOf<T extends string>() {
	return <L extends readonly T[]>(
		list: L & ([T] extends [L[number]] ? unknown : { missing: Exclude<T, L[number]> })
	): L => list;
}

export const LIST_DIFF_TARGETS = membersOf<DiffTarget>()(['editor', 'panel']);
export const LIST_GRAPH_STYLES = membersOf<GraphStyle>()([
	'rounded',
	'curved',
	'angular',
	'diagonal',
]);
export const LIST_COMMIT_ORDERS = membersOf<CommitOrder>()(['date', 'authorDate', 'topo']);
export const LIST_DATE_TYPES = membersOf<DateType>()(['commit', 'author']);

/**
 * What the Pull button runs. `config` is a plain `git pull` — the repository's own `pull.ff` and
 * `pull.rebase` decide, as they always have. The others state a strategy on the command line, so
 * a repository configured to write a merge commit on every pull (`pull.ff false`) can be pulled
 * cleanly without touching its config.
 */
export type PullStrategy = 'config' | 'ff' | 'ffOnly' | 'rebase';
export const LIST_PULL_STRATEGIES = membersOf<PullStrategy>()(['config', 'ff', 'ffOnly', 'rebase']);

export const MAP_PULL_STRATEGY_LABEL: Record<PullStrategy, string> = {
	config: 'Follow git config',
	ff: 'Fast-forward if possible',
	ffOnly: 'Fast-forward only',
	rebase: 'Rebase',
};

/** The host action the Pull button sends for a strategy. */
export function pullActionFor(strategy: PullStrategy): RepoActionId {
	const mapAction: Record<PullStrategy, RepoActionId> = {
		config: 'pull',
		ff: 'pullFfIfPossible',
		ffOnly: 'pullFf',
		rebase: 'pullRebase',
	};
	return mapAction[strategy];
}

/** The member `raw` names, or nothing when it names none. */
export function pickOption<T extends string>(listValid: readonly T[], raw: string): T | undefined {
	return listValid.find((option) => option === raw);
}

export interface ViewSettings {
	commitLimit: number;
	commitOrder: CommitOrder;
	dateType: DateType;
	graphStyle: GraphStyle;
	rowDensity: RowDensity;
	diffTarget: DiffTarget;
	diffMode: DiffMode;
	/** One column of changes, or old and new side by side. */
	diffLayout: DiffLayout;
	/** Wrap long lines instead of scrolling sideways; split view always wraps. */
	diffWrap: boolean;
	/** Diff with `-w`: changes that are only whitespace drop out. */
	diffIgnoreWhitespace: boolean;
	/** Push straight after a commit made from the commit dialog. */
	pushAfterCommit: boolean;
	/** Left-to-right order of the columns right of Description. */
	columnOrder: OptionalColumn[];
	fetchAvatars: boolean;
	highlightBranchOnHover: boolean;
	muteMergeCommits: boolean;
	/** Off for either one leaves that part of the subject as plain text. */
	showTicketBadge: boolean;
	showTypeBadge: boolean;
	showRemoteBranches: boolean;
	showTags: boolean;
	/** Whether a branch chip shows how far it has drifted from its upstream. */
	showTrackingBadges: boolean;
	/** Name the lane a selected or hovered commit sits on, when it carries no ref of its own. */
	showGhostBranch: boolean;
	showStashes: boolean;
	showUncommitted: boolean;
	scrollToHeadOnLoad: boolean;
	autoFastForwardOnCheckout: boolean;
	pullStrategy: PullStrategy;
	/** Minutes between background fetches; 0 is never. Default lives in `shared`, see below. */
	autoFetchMinutes: number;
	/** Apply a saved identity automatically when exactly one matches the repository's remotes. */
	autoApplyIdentity: boolean;
}

/** The active repository's effective Git identity, as reported by the host. */
export interface RepoIdentityState {
	name: string | null;
	email: string | null;
	hasLocalName: boolean;
	hasLocalEmail: boolean;
	listRemoteUrls: string[];
	/** The global config's identity, reported even while a local override hides it. */
	globalName: string | null;
	globalEmail: string | null;
}

export interface ColumnVisibility {
	author: boolean;
	commit: boolean;
	date: boolean;
	/** Lines added and removed per commit, read lazily for the rows on screen. */
	changes: boolean;
}

/** The columns pinned right of Description, which can be hidden and reordered. */
export type OptionalColumn = keyof ColumnVisibility;
export const LIST_DEFAULT_COLUMN_ORDER: OptionalColumn[] = ['author', 'commit', 'date', 'changes'];

/**
 * A stored column order made whole: unknown and repeated keys dropped, missing ones added at the
 * end in their default order — so an old or damaged blob can reorder columns but never lose one.
 */
export function normalizeColumnOrder(raw: unknown): OptionalColumn[] {
	const listKnown = LIST_DEFAULT_COLUMN_ORDER as string[];
	const listKept = (Array.isArray(raw) ? raw : []).filter(
		(key, index, list): key is OptionalColumn =>
			typeof key === 'string' && listKnown.includes(key) && list.indexOf(key) === index
	);
	return [...listKept, ...LIST_DEFAULT_COLUMN_ORDER.filter((key) => !listKept.includes(key))];
}

/** `from` moved to where `to` stands, the others keeping their order. */
export function moveColumn(
	listOrder: OptionalColumn[],
	from: OptionalColumn,
	to: OptionalColumn
): OptionalColumn[] {
	if (from === to) return listOrder;
	const listRest = listOrder.filter((key) => key !== from);
	const at = listOrder.indexOf(to);
	const insertAt = listOrder.indexOf(from) < at ? listRest.indexOf(to) + 1 : listRest.indexOf(to);
	return [...listRest.slice(0, insertAt), from, ...listRest.slice(insertAt)];
}

/** User-resizable column widths, in pixels. */
export interface ColumnWidths {
	ref: number;
	author: number;
	commit: number;
	date: number;
	changes: number;
}

export type ColumnKey = keyof ColumnWidths;

/**
 * The defaults, and nothing else. What the user actually chose arrives from the host as a
 * `viewSettings` message and is laid over these — one source of truth, so a stale copy in some
 * workspace can never win an argument with it.
 */
export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
	commitLimit: 300,
	commitOrder: 'date',
	dateType: 'commit',
	graphStyle: 'rounded',
	rowDensity: 'comfortable',
	diffTarget: 'panel',
	diffMode: 'compact',
	diffLayout: 'unified',
	diffWrap: false,
	diffIgnoreWhitespace: false,
	pushAfterCommit: false,
	columnOrder: LIST_DEFAULT_COLUMN_ORDER,
	fetchAvatars: false,
	highlightBranchOnHover: false,
	muteMergeCommits: false,
	showTicketBadge: true,
	showTypeBadge: true,
	showRemoteBranches: true,
	showTags: true,
	showTrackingBadges: true,
	showGhostBranch: true,
	showStashes: true,
	showUncommitted: true,
	scrollToHeadOnLoad: false,
	autoFastForwardOnCheckout: true,
	// `config` changes nothing for anyone: it is what the button always ran.
	pullStrategy: 'config',
	autoFetchMinutes: DEFAULT_AUTO_FETCH_MINUTES,
	// Off by default: silently changing what a commit is signed as must be asked for.
	autoApplyIdentity: false,
};

/**
 * Preferences are the user's, not the folder's, so the host keeps them in global state and hands
 * them back on load. What stays local to this workspace is only what depends on it: the column
 * widths and the panel split, which are chosen for this window and this repository's ref names.
 *
 * Everything is spread over the defaults, so a value saved by an older version — or by a
 * version that had a setting this one dropped — degrades to the default instead of breaking.
 */
export interface GlobalPreferences {
	settings: ViewSettings;
	columns: ColumnVisibility;
	fileView: FileViewMode;
	metaOpen: boolean;
}

/**
 * Lay a stored preferences blob over the current values. Spread over the defaults rather than
 * replacing them: a setting this version added is simply missing from an older blob, and must
 * land on its default instead of `undefined`.
 */
export function mergePreferences(
	current: GlobalPreferences,
	stored: Record<string, unknown>
): GlobalPreferences {
	const next = stored as Partial<GlobalPreferences>;
	return {
		settings: next.settings ? { ...current.settings, ...next.settings } : current.settings,
		columns: next.columns ? { ...current.columns, ...next.columns } : current.columns,
		fileView: next.fileView ?? current.fileView,
		metaOpen: typeof next.metaOpen === 'boolean' ? next.metaOpen : current.metaOpen,
	};
}

/** Fields the host's log walk depends on force a reload; pure view settings do not. */
export function settingsRequireReload(prev: ViewSettings, next: ViewSettings): boolean {
	return (
		next.commitLimit !== prev.commitLimit ||
		next.fetchAvatars !== prev.fetchAvatars ||
		next.commitOrder !== prev.commitOrder ||
		next.showRemoteBranches !== prev.showRemoteBranches ||
		next.showTags !== prev.showTags ||
		next.showStashes !== prev.showStashes ||
		next.showUncommitted !== prev.showUncommitted
	);
}
