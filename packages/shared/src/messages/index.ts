/**
 * Host ↔ webview message protocol.
 * P1: commit graph. P2: commit details, diffs, commit actions. P3: working tree, repos & filters.
 */
import type {
	Commit,
	CommitDetails,
	DiffHunk,
	FileChange,
	WorkingTreeStatus,
} from '../model/index.js';

/** A Git repository discovered in the workspace. */
export interface RepoInfo {
	path: string;
	name: string;
}

/**
 * A branch offered in the jump dropdown. `name` is the short form — `main` for a local branch,
 * `origin/main` for a remote-tracking one — and `hash` is the commit it points at, so the view can
 * jump straight to a row without re-deriving the tip from the decorations it happens to have.
 */
export interface BranchRef {
	name: string;
	hash: string;
	remote: boolean;
}

/** How `git log` orders the walk. */
export type CommitOrder = 'date' | 'authorDate' | 'topo';

/** Filters and options applied when loading the graph. */
export interface GraphFilters {
	/** A specific branch to show, or null for "Show All". */
	branch: string | null;
	showRemoteBranches: boolean;
	/**
	 * Opt-in: derive Gravatar URLs from author emails. Enabling this means author email hashes
	 * are sent to gravatar.com when the images load.
	 */
	fetchAvatars?: boolean;
	/** Defaults to 'date' when omitted. */
	commitOrder?: CommitOrder;
	/** These default to true when omitted, matching the original behaviour. */
	showTags?: boolean;
	showStashes?: boolean;
	showUncommitted?: boolean;
}

export interface LoadCommitsMessage {
	type: 'loadCommits';
	limit: number;
	filters?: GraphFilters;
}

export interface SelectRepoMessage {
	type: 'selectRepo';
	path: string;
}

export interface LoadCommitDetailsMessage {
	type: 'loadCommitDetails';
	hash: string;
}

export interface OpenDiffMessage {
	type: 'openDiff';
	hash: string;
	path: string;
	/** The path before a rename — the left side of the diff reads this path at the parent. */
	oldPath?: string;
}

export interface LoadComparisonMessage {
	type: 'loadComparison';
	fromHash: string;
	toHash: string;
}

/**
 * Ask for one file's diff as hunks, to be drawn inside the view instead of a VS Code diff editor.
 * Exactly one of `hash`, the `fromHash`/`toHash` pair, or neither (the working tree) is given.
 */
export interface LoadFileDiffMessage {
	type: 'loadFileDiff';
	/** Echoed back untouched, so a reply that arrives after the user moved on is ignorable. */
	key: string;
	path: string;
	/** The path before a rename, so the hunks show old → new instead of a whole-file add. */
	oldPath?: string;
	hash?: string;
	fromHash?: string;
	toHash?: string;
	untracked?: boolean;
	/** Context lines: small for the changes-only view, larger than any file for the whole-file one. */
	context: number;
}

export interface FileDiffMessage {
	type: 'fileDiff';
	key: string;
	path: string;
	listHunks: DiffHunk[];
	/** Set when there is nothing to draw — binary, unchanged, or unreadable — and says why. */
	notice?: string;
}

export interface OpenCompareDiffMessage {
	type: 'openCompareDiff';
	fromHash: string;
	toHash: string;
	path: string;
	/** The path before a rename — the left side of the diff reads this path at `fromHash`. */
	oldPath?: string;
}

export type CommitActionId =
	| 'checkout'
	| 'createBranch'
	| 'merge'
	| 'rebase'
	| 'cherryPick'
	| 'revert'
	| 'reword'
	| 'resetSoft'
	| 'resetMixed'
	| 'resetHard'
	| 'addTag'
	| 'deleteTag'
	| 'pushTag'
	| 'deleteRemoteTag'
	| 'openOnRemote'
	| 'copyRemoteUrl'
	| 'deleteBranch'
	| 'checkoutBranch'
	| 'checkoutRemote'
	| 'deleteRemoteBranch'
	| 'fetchIntoLocal'
	| 'stashApply'
	| 'stashPop'
	| 'stashDrop'
	| 'stashBranch'
	| 'copyHash'
	| 'copySubject';

export interface CommitActionMessage {
	type: 'commitAction';
	/**
	 * The repository this action was created against — required, and the host refuses the
	 * action when it does not match the active repository. A menu or dialog built over one
	 * repo must not run over another that was switched to while it sat open.
	 */
	repoPath: string;
	action: CommitActionId;
	hash: string;
	subject: string;
	/** Local branch names pointing at this commit (for the delete-branch action). */
	branches: string[];
	/** Remote-tracking branch names at this commit, e.g. "origin/main". */
	remoteBranches: string[];
	/** Tag names at this commit (for the tag actions). */
	tags?: string[];
	/** Stash reference (e.g. "stash@{0}") when the commit is a stash. */
	stashName?: string;
}

/**
 * Squash a contiguous run of commits into one. The webview guarantees the run is a first-parent
 * chain (no merges, no root); the host re-checks everything that needs repository state.
 */
export interface SquashCommitsMessage {
	type: 'squashCommits';
	/**
	 * The repository this action was created against — required, and the host refuses the
	 * action when it does not match the active repository. A menu or dialog built over one
	 * repo must not run over another that was switched to while it sat open.
	 */
	repoPath: string;
	/** Newest → oldest. */
	hashes: string[];
	/** Subjects in the same order, used to prefill and record the combined message. */
	subjects: string[];
}

/**
 * Act on a multi-selected run of commits. Cherry-pick and revert accept any merge-free selection;
 * drop needs the same contiguous first-parent chain as squash.
 */
export interface MultiCommitActionMessage {
	type: 'multiCommitAction';
	/**
	 * The repository this action was created against — required, and the host refuses the
	 * action when it does not match the active repository. A menu or dialog built over one
	 * repo must not run over another that was switched to while it sat open.
	 */
	repoPath: string;
	action: 'cherryPick' | 'revert' | 'drop';
	/** Newest → oldest. */
	hashes: string[];
	/** Subjects in the same order, for confirmation prompts. */
	subjects: string[];
}

/** Drive an in-progress rebase / merge / cherry-pick / revert forward or abandon it. */
export interface SequencerActionMessage {
	type: 'sequencerAction';
	/**
	 * The repository this action was created against — required, and the host refuses the
	 * action when it does not match the active repository. A menu or dialog built over one
	 * repo must not run over another that was switched to while it sat open.
	 */
	repoPath: string;
	action: 'continue' | 'abort' | 'skip';
}

/** What dropping one branch chip onto another can do. */
export type BranchActionId = 'mergeInto' | 'rebaseOnto' | 'fastForward';

export interface BranchActionMessage {
	type: 'branchAction';
	/**
	 * The repository this action was created against — required, and the host refuses the
	 * action when it does not match the active repository. A menu or dialog built over one
	 * repo must not run over another that was switched to while it sat open.
	 */
	repoPath: string;
	action: BranchActionId;
	/** The dragged branch: a local name, or a remote-tracking one such as "origin/main". */
	source: string;
	/** The branch dropped onto — always local, since Git can only write a local ref. */
	target: string;
}

/**
 * Ask whether `target` can be fast-forwarded to `source`, so the drop menu only offers it when it
 * would work. `nonce` comes back untouched: a stale reply from an abandoned drag is then ignorable.
 */
export interface CheckFastForwardMessage {
	type: 'checkFastForward';
	source: string;
	target: string;
	nonce: number;
}

export interface FastForwardCheckMessage {
	type: 'fastForwardCheck';
	nonce: number;
	canFastForward: boolean;
}

export type WorkingTreeAction =
	| 'stage'
	| 'unstage'
	| 'stageAll'
	| 'unstageAll'
	| 'discard'
	| 'stash'
	| 'commit'
	| 'amend'
	| 'undoCommit';

export type RepoActionId = 'fetch' | 'push' | 'pushForce' | 'pull' | 'pullRebase' | 'pullFf';

export interface RepoActionMessage {
	type: 'repoAction';
	/**
	 * The repository this action was created against — required, and the host refuses the
	 * action when it does not match the active repository. A menu or dialog built over one
	 * repo must not run over another that was switched to while it sat open.
	 */
	repoPath: string;
	action: RepoActionId;
}

export interface WorkingTreeActionMessage {
	type: 'workingTreeAction';
	/**
	 * The repository this action was created against — required, and the host refuses the
	 * action when it does not match the active repository. A menu or dialog built over one
	 * repo must not run over another that was switched to while it sat open.
	 */
	repoPath: string;
	action: WorkingTreeAction;
	path?: string;
	message?: string;
}

export interface OpenWorkingDiffMessage {
	type: 'openWorkingDiff';
	path: string;
}

export interface OpenFileMessage {
	type: 'openFile';
	path: string;
	/** Open the file as it stood at this commit; omitted for the working copy on disk. */
	hash?: string;
}

export interface CopyFilePathMessage {
	type: 'copyFilePath';
	path: string;
	/** Copy the path on disk; otherwise the path relative to the repository root. */
	absolute: boolean;
}

export interface OpenTerminalMessage {
	type: 'openTerminal';
}

/**
 * The view's own preferences, kept by the host so they follow the user between workspaces.
 *
 * Deliberately opaque here: what a setting means is the view's business, and the host only stores
 * the blob and hands it back. The view spreads it over its defaults, so a key added, removed or
 * renamed on either side degrades to the default instead of breaking the protocol.
 */
export interface SaveViewSettingsMessage {
	type: 'saveViewSettings';
	settings: Record<string, unknown>;
}

export interface ViewSettingsMessage {
	type: 'viewSettings';
	/** Null the first time this user opens the view, before anything has been saved. */
	settings: Record<string, unknown> | null;
}

/** A saved Git identity the user can apply to a repository (e.g. "Work", "Personal"). */
export interface GitIdentity {
	label: string;
	name: string;
	email: string;
	/**
	 * Substring matched against the repository's remote URLs (e.g. "github.com/mycompany"). When it
	 * matches and the repository uses a different email, the view suggests this identity.
	 */
	hostPattern?: string;
}

/** Ask the host for the active repository's Git identity and the saved identities. */
export interface LoadIdentityMessage {
	type: 'loadIdentity';
}

export interface IdentityActionMessage {
	type: 'identityAction';
	/** apply → write `user.name`/`user.email` to the repo's local config; clearOverride → unset both. */
	action: 'apply' | 'clearOverride';
	name?: string;
	email?: string;
	/**
	 * Saved identities to persist before applying. Adding an identity and switching to it is one
	 * user action; sending it as one message keeps the save from racing the reload that follows.
	 */
	listIdentities?: GitIdentity[];
}

export interface SaveIdentitiesMessage {
	type: 'saveIdentities';
	listIdentities: GitIdentity[];
}

/** One local branch, with everything the cleanup dialog needs to judge whether it can go. */
export interface BranchInventoryEntry {
	name: string;
	hash: string;
	subject: string;
	/** ISO-8601 committer date of the tip — the branch's age is measured from this. */
	committedAt: string;
	/** Reachable from the base revision, so `git branch -d` accepts it. */
	merged: boolean;
	/** Had an upstream that no longer exists on the remote. */
	upstreamGone: boolean;
	current: boolean;
}

/** Ask the host for every local branch. Sent once per opening of the cleanup dialog. */
export interface LoadBranchInventoryMessage {
	type: 'loadBranchInventory';
}

export interface CleanupBranchesMessage {
	type: 'cleanupBranches';
	/**
	 * The repository this action was created against — required, and the host refuses the
	 * action when it does not match the active repository. A menu or dialog built over one
	 * repo must not run over another that was switched to while it sat open.
	 */
	repoPath: string;
	listNames: string[];
	/**
	 * The tip each listed branch pointed at when the dialog showed it — required, one entry per
	 * name. A branch missing here, or whose tip has moved since, is refused: the user would be
	 * deleting commits they never saw in the list.
	 */
	mapExpectedTips: Record<string, string>;
	/** Use `-D` instead of `-d`, needed for branches that are not merged into the base. */
	force: boolean;
}

export interface BranchInventoryMessage {
	type: 'branchInventory';
	listBranches: BranchInventoryEntry[];
	/** What `merged` was measured against, null when there was nothing to measure against. */
	mergedBase: string | null;
}

export interface BranchCleanupOutcome {
	name: string;
	/** The tip the branch pointed at, so a mistaken delete can be undone with `git branch`. */
	hash: string;
	ok: boolean;
	reason?: string;
}

export interface BranchCleanupResultMessage {
	type: 'branchCleanupResult';
	listResults: BranchCleanupOutcome[];
}

export interface CopyTextMessage {
	type: 'copyText';
	text: string;
	/** Shown in the confirmation notice, e.g. "commit hash". */
	label: string;
}

/** Messages sent from the webview to the extension host. */
export type WebviewToHost =
	| LoadCommitsMessage
	| SelectRepoMessage
	| LoadCommitDetailsMessage
	| LoadComparisonMessage
	| LoadFileDiffMessage
	| OpenDiffMessage
	| OpenCompareDiffMessage
	| CommitActionMessage
	| SquashCommitsMessage
	| MultiCommitActionMessage
	| SequencerActionMessage
	| BranchActionMessage
	| CheckFastForwardMessage
	| WorkingTreeActionMessage
	| RepoActionMessage
	| OpenWorkingDiffMessage
	| OpenFileMessage
	| CopyFilePathMessage
	| OpenTerminalMessage
	| SaveViewSettingsMessage
	| CopyTextMessage
	| LoadIdentityMessage
	| IdentityActionMessage
	| SaveIdentitiesMessage
	| LoadBranchInventoryMessage
	| CleanupBranchesMessage;

/** An operation paused mid-flight (usually on conflicts), waiting to be continued or aborted. */
export type RepoState = 'rebasing' | 'merging' | 'cherryPicking' | 'reverting';

export interface CommitsMessage {
	type: 'commits';
	/** What the walk behind this answer was actually run with — lets a view drop stale replies. */
	limit?: number;
	filters?: GraphFilters;
	commits: Commit[];
	working: WorkingTreeStatus | null;
	repoState: RepoState | null;
	/** Whether history continues past the last loaded commit. */
	hasMore: boolean;
	repos: RepoInfo[];
	activeRepo: string | null;
	repoName: string | null;
	/** Branches offered in the Branch dropdown (local first, then remote). */
	listBranches: BranchRef[];
	currentBranch: string | null;
	/** The commit HEAD points at — null in an empty repository. */
	headHash: string | null;
	/** Commits the current branch is ahead of / behind its upstream. */
	ahead: number;
	behind: number;
}

/**
 * A working-tree-only update, sent when something changed that history did not: files edited,
 * staged, or the branch's ahead/behind moving. The graph rows are left exactly as they are.
 */
export interface StatusUpdateMessage {
	type: 'statusUpdate';
	working: WorkingTreeStatus | null;
	/** Staged plus unstaged, used to relabel the synthetic uncommitted-changes row. */
	changeCount: number;
	ahead: number;
	behind: number;
	repoState: RepoState | null;
	currentBranch: string | null;
	/**
	 * The commit HEAD points at. A status update whose HEAD differs from the last full load means
	 * history changed without a graph reload — the sender upgrades to one instead of posting this.
	 */
	headHash: string | null;
}

export interface CommitDetailsMessage {
	type: 'commitDetails';
	details: CommitDetails;
}

export interface ComparisonMessage {
	type: 'comparison';
	fromHash: string;
	toHash: string;
	files: FileChange[];
}

/**
 * One icon from the user's file-icon theme. Themes ship icons one of two ways: as image files, or
 * as glyphs in a bundled font (the built-in Seti theme does the latter).
 */
export type FileIcon =
	{ kind: 'image'; src: string } | { kind: 'glyph'; char: string; fontId: string; colour?: string };

export interface FileIconFont {
	id: string;
	listSrc: { url: string; format?: string }[];
	weight?: string;
	style?: string;
	/** CSS size, normally a percentage of the surrounding text, e.g. "150%". */
	size?: string;
}

/**
 * The user's active file-icon theme, flattened for lookup. Names and extensions are lowercase, and
 * every lookup value is a key into `mapIcons`.
 */
export interface FileIconTheme {
	mapIcons: Record<string, FileIcon>;
	listFonts: FileIconFont[];
	/** Fallback icon ids, used when no name or extension matches. */
	file: string | null;
	folder: string | null;
	folderExpanded: string | null;
	mapFileNames: Record<string, string>;
	mapFileExtensions: Record<string, string>;
	mapFolderNames: Record<string, string>;
	mapFolderNamesExpanded: Record<string, string>;
}

export interface FileIconsMessage {
	type: 'fileIcons';
	/** null when no icon theme is active or it could not be read; the view falls back to codicons. */
	theme: FileIconTheme | null;
}

export interface IdentityMessage {
	type: 'identity';
	/** Effective values (the local override when present, otherwise inherited), null when unset. */
	name: string | null;
	email: string | null;
	/** Whether the repository's own local config overrides each field. */
	hasLocalName: boolean;
	hasLocalEmail: boolean;
	/** The global config's identity, sent even while a local override hides it. */
	globalName: string | null;
	globalEmail: string | null;
	listRemoteUrls: string[];
	listIdentities: GitIdentity[];
}

/**
 * The active colour theme's broad kind, so the diff panel can highlight with a matching Shiki
 * theme. High-contrast themes map onto their base kind. Sent on webview startup and again
 * whenever the user switches theme.
 */
export interface ColorThemeMessage {
	type: 'colorTheme';
	kind: 'dark' | 'light';
}

/** Ask the webview to select a commit and scroll it into view (sent by the sidebar tree). */
export interface RevealCommitMessage {
	type: 'revealCommit';
	hash: string;
}

export interface ErrorMessage {
	type: 'error';
	message: string;
	repos: RepoInfo[];
	activeRepo: string | null;
	/**
	 * The request type that failed, when known. A failed side query (details, comparison, file
	 * diff) is then reported inside the panel that asked, instead of replacing the whole graph
	 * with an error screen.
	 */
	source?: WebviewToHost['type'];
}

/** Messages sent from the extension host to the webview. */
export type HostToWebview =
	| CommitsMessage
	| StatusUpdateMessage
	| CommitDetailsMessage
	| ComparisonMessage
	| FileDiffMessage
	| ViewSettingsMessage
	| FileIconsMessage
	| ColorThemeMessage
	| IdentityMessage
	| FastForwardCheckMessage
	| RevealCommitMessage
	| BranchInventoryMessage
	| BranchCleanupResultMessage
	| ErrorMessage;
