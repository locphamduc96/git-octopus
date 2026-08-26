import type { CommitOrder } from '@git-octopus/shared';
import type { FileViewMode } from './fileTree';
import type { GraphStyle } from './graphPath';

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
/** Which of a commit's two dates the Date column shows. */
export type DateType = 'commit' | 'author';

export interface ViewSettings {
	commitLimit: number;
	commitOrder: CommitOrder;
	dateType: DateType;
	graphStyle: GraphStyle;
	rowDensity: RowDensity;
	diffTarget: DiffTarget;
	diffMode: DiffMode;
	fetchAvatars: boolean;
	highlightBranchOnHover: boolean;
	muteMergeCommits: boolean;
	/** Off for either one leaves that part of the subject as plain text. */
	showTicketBadge: boolean;
	showTypeBadge: boolean;
	showRemoteBranches: boolean;
	showTags: boolean;
	showStashes: boolean;
	showUncommitted: boolean;
	scrollToHeadOnLoad: boolean;
	autoFastForwardOnCheckout: boolean;
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
}

/** User-resizable column widths, in pixels. */
export interface ColumnWidths {
	ref: number;
	author: number;
	commit: number;
	date: number;
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
	fetchAvatars: false,
	highlightBranchOnHover: false,
	muteMergeCommits: false,
	showTicketBadge: true,
	showTypeBadge: true,
	showRemoteBranches: true,
	showTags: true,
	showStashes: true,
	showUncommitted: true,
	scrollToHeadOnLoad: false,
	autoFastForwardOnCheckout: true,
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
