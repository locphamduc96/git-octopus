/**
 * Host ↔ webview message protocol.
 * P1: commit graph. P2: commit details, diffs, commit actions. P3: working tree, repos & filters.
 */
import type {
	Commit,
	CommitDetails,
	DiffHunk,
	FileChange,
	FileStatus,
	Person,
	UpstreamTracking,
	WorkingTreeStatus,
} from '../model/index.js';

/** A Git repository discovered in the workspace. */
export interface RepoInfo {
	path: string;
	name: string;
	/** A submodule: the repository that records it, and where inside that one it sits. */
	parent?: string;
	subPath?: string;
}

/** A submodule's pointer moving, as the diff panel shows it in place of hunks. */
export interface SubmoduleDiff {
	/** Abbreviated or full commit ids; absent on the side where the submodule does not exist. */
	from?: string;
	to?: string;
	/** The submodule's checkout has edits of its own (`-dirty`), which no diff here shows. */
	dirty: boolean;
	/** The submodule as a repository this view can switch to, or null when it is not checked out. */
	repoPath: string | null;
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
	/**
	 * Drift from the upstream, for local branches that have one. Optional so a message from an
	 * older host degrades to "nothing known" rather than to a record of zeroes, which would be
	 * drawn as "in sync" — the one reading a user would act on.
	 */
	tracking?: UpstreamTracking | null;
}

/**
 * A remote-tracking branch, as two fields rather than one `origin/main` string.
 *
 * Git allows a remote name to contain a slash (`team/origin`), so splitting the joined form at
 * the first slash names the wrong branch, and it allows one to begin with `-`, which puts an
 * option where a ref was meant to go. Neither is recoverable once the two have been flattened,
 * so they never are.
 */
export interface RemoteBranchRef {
	remote: string;
	branch: string;
}

/**
 * The unambiguous ref path — what to hand `git` as a revision.
 *
 * Always safe as a positional argument: it starts with `refs/`, so no remote name can turn it
 * into an option, and the remote's own slashes stop mattering because nothing has to be split
 * back out of it.
 */
export function remoteRefPath(ref: RemoteBranchRef): string {
	return `refs/remotes/${ref.remote}/${ref.branch}`;
}

/** The familiar `origin/main` form — for reading, never for handing to git. */
export function remoteRefLabel(ref: RemoteBranchRef): string {
	return `${ref.remote}/${ref.branch}`;
}

/** How `git log` orders the walk. */
export type CommitOrder = 'date' | 'authorDate' | 'topo';

/** Filters and options applied when loading the graph. */
/** Refs left out of the graph, each named the way its namespace names it (`feature`, `origin/x`, `v1`). */
export interface HiddenRefs {
	listBranches: string[];
	listRemotes: string[];
	listTags: string[];
}

export interface GraphFilters {
	/** A specific branch to show, or null for "Show All". The first of `listSoloRefs` when that is set. */
	branch: string | null;
	/** Walk these refs and nothing else; empty or absent walks everything. */
	listSoloRefs?: string[];
	/** Leave these refs out of the walk, and their chips off the commits that remain. */
	hiddenRefs?: HiddenRefs;
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
	/** Ask git to verify every signed commit — off by default, since each one runs gpg or ssh. */
	showSignatures?: boolean;
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
	/** Diff with `-w`, so changes that are only whitespace drop out. */
	ignoreWhitespace?: boolean;
	/** A working-tree file: only its unstaged or only its staged part, instead of HEAD → disk. */
	side?: WorkingDiffSide;
}

/** The commits that touched one file, newest first, following it across renames. */
export interface LoadFileHistoryMessage {
	type: 'loadFileHistory';
	path: string;
	/** Walk from this commit; absent walks from HEAD. */
	rev?: string;
}

export interface FileHistoryEntry {
	hash: string;
	subject: string;
	author: Person;
	authoredAt: number;
	/** What this commit did to the file. */
	status: FileStatus;
	/** The file's name at this commit, which a rename further on may have changed. */
	path: string;
	/** Set on the commit that renamed the file: its name before. */
	oldPath?: string;
}

export interface FileHistoryMessage {
	type: 'fileHistory';
	path: string;
	rev: string | null;
	listEntries: FileHistoryEntry[];
	/** More commits touched the file than were read. */
	truncated: boolean;
	/** Set when the history could not be read, and says why. */
	error?: string;
}

/**
 * Whether a commit or amend asked from the commit dialog went through. Sent only to the view that
 * asked: a refused commit (a hook, an empty message) brings the dialog back with what was typed.
 */
export interface CommitOutcomeMessage {
	type: 'commitOutcome';
	ok: boolean;
}

/** How big each of these commits is, for the Changes column. Asked only for the rows on screen. */
export interface LoadCommitStatsMessage {
	type: 'loadCommitStats';
	listHashes: string[];
}

/** A commit's size: a merge is measured against its first parent, like its file list. */
export interface CommitStat {
	hash: string;
	files: number;
	insertions: number;
	deletions: number;
}

export interface CommitStatsMessage {
	type: 'commitStats';
	/** One per hash asked that could be read; a hash left out could not be. */
	listStats: CommitStat[];
}

/** Who last changed each line of a file, at a commit or in the working tree. */
export interface LoadBlameMessage {
	type: 'loadBlame';
	/** Echoed back, like `loadFileDiff`'s, so a late answer for another file is recognisable. */
	key: string;
	path: string;
	/** Blame the file as of this commit; absent blames the working tree copy. */
	rev?: string;
}

export interface BlameCommit {
	author: string;
	authoredAt: number;
	summary: string;
}

export interface BlameMessage {
	type: 'blame';
	key: string;
	path: string;
	listLines: string[];
	/** The commit of each line, by index; all zeros for a line not committed yet. */
	listLineHashes: string[];
	mapCommits: Record<string, BlameCommit>;
	/** Set when there is nothing to draw, and says why. */
	notice?: string;
}

/** What a Git LFS pointer names: the object's hash and its size in bytes. */
export interface LfsPointer {
	oid: string;
	size: number;
}

/** One side of an image diff, inline. */
export interface ImageSide {
	dataUri: string;
	bytes: number;
}

export interface FileDiffMessage {
	type: 'fileDiff';
	key: string;
	path: string;
	listHunks: DiffHunk[];
	/** Set when there is nothing to draw — binary, unchanged, or unreadable — and says why. */
	notice?: string;
	/** An image: its sides before and after, whichever exist, instead of hunks. */
	image?: { before?: ImageSide; after?: ImageSide };
	/** A file Git LFS stores: what its pointer names on each side, instead of the pointer's text. */
	lfs?: { before?: LfsPointer; after?: LfsPointer };
	submodule?: SubmoduleDiff;
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
	| 'renameBranch'
	| 'setUpstream'
	| 'unsetUpstream'
	| 'checkoutBranch'
	| 'checkoutRemote'
	| 'checkoutPrevious'
	| 'deleteRemoteBranch'
	| 'fetchIntoLocal'
	| 'pushBranch'
	| 'stashApply'
	| 'stashPop'
	| 'stashDrop'
	| 'stashBranch'
	| 'copyHash'
	| 'copySubject'
	| 'copyRefName';

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
	/** Remote-tracking branches at this commit, remote and branch kept apart. */
	remoteBranches: RemoteBranchRef[];
	/** Tag names at this commit (for the tag actions). */
	tags?: string[];
	/** Stash reference (e.g. "stash@{0}") when the commit is a stash. */
	stashName?: string;
	/**
	 * The state the detached-HEAD banner was showing when its button was pressed, for
	 * `checkoutPrevious`. The host re-reads both and refuses when either has moved: the banner can
	 * sit on screen while a terminal checks something else out, and "Back to main" must not become
	 * "back to wherever HEAD happens to have been".
	 */
	expected?: {
		/** The branch the banner named. */
		previousBranch: string;
		/** The commit the banner said HEAD was detached at. */
		headHash: string;
	};
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
	action: 'cherryPick' | 'revert' | 'drop' | 'rebaseRange';
	/** Newest → oldest. */
	hashes: string[];
	/** Subjects in the same order, for confirmation prompts. */
	subjects: string[];
}

/**
 * The view gained or lost keyboard focus. VS Code reads its keybindings for the graph (Mod+B,
 * Mod+L) off this, so they take over those keys only while the graph has focus.
 */
export interface ViewFocusMessage {
	type: 'viewFocus';
	focused: boolean;
}

/** A keybinding VS Code resolved while the graph had focus, handed to the view to act on. */
export interface HostCommandMessage {
	type: 'hostCommand';
	command: HostCommand;
}

/** A keybinding or a menu item the shell resolved, for the view to act on. */
export type HostCommand = 'createBranch' | 'fetch' | 'refresh' | 'openSettings';

/**
 * What the shell can do, sent once a view is listening. VS Code does not send it: everything here
 * defaults to what VS Code offers, so only the desktop app says anything.
 */
export interface HostCapabilities {
	/** The desktop app rather than an editor — no editor to open a diff in, no editor chrome. */
	desktop: boolean;
	/** Diffs can open in an editor of their own; without one they always open in the view. */
	editorDiff: boolean;
}

export interface CapabilitiesMessage extends HostCapabilities {
	type: 'capabilities';
}

/**
 * A notice from the host, where the shell has no notifications of its own to show it in (the
 * desktop app). Answered with `hostNoticeReply` when it offers actions.
 */
export interface HostNoticeMessage {
	type: 'hostNotice';
	id: number;
	level: 'info' | 'warning' | 'error';
	message: string;
	listActions: string[];
}

export interface HostNoticeReplyMessage {
	type: 'hostNoticeReply';
	id: number;
	/** The action chosen; absent when the notice was dismissed. */
	action?: string;
}

/** A task the host is running, for the view to show while it lasts — the desktop app only. */
export interface HostProgressMessage {
	type: 'hostProgress';
	id: number;
	title: string;
	/** The line under the title, replacing the previous one. */
	message?: string;
	cancellable: boolean;
	/** The task finished; the indicator goes. */
	done: boolean;
}

export interface HostProgressCancelMessage {
	type: 'hostProgressCancel';
	id: number;
}

/**
 * Git or ssh is waiting on a credential, and the shell has no dialog of its own to ask in (the
 * desktop app). Answered with `credentialReply`; withdrawn with `credentialCancel` once the asking
 * git process is gone. `title` is the host's own words; `prompt` is what git asked — data, shown
 * as text.
 */
export interface CredentialRequestMessage {
	type: 'credentialRequest';
	id: number;
	title: string;
	prompt: string;
	/** Mask the answer. */
	secret: boolean;
	/** A yes/no question (a host key to trust): two buttons, answered `yes` or `no`. */
	confirm: boolean;
}

export interface CredentialCancelMessage {
	type: 'credentialCancel';
	id: number;
}

/** Markdown for the view to show in a panel of its own — an AI explanation in the desktop app. */
export interface ShowMarkdownMessage {
	type: 'showMarkdown';
	title: string;
	content: string;
}

/** The answer to a `credentialRequest`; no `answer` means the user cancelled. */
export interface CredentialReplyMessage {
	type: 'credentialReply';
	id: number;
	answer?: string;
}

/** Save the Markdown panel's text to a file the user picks. */
export interface SaveMarkdownMessage {
	type: 'saveMarkdown';
	content: string;
	suggestedName: string;
}

/** A link in the Markdown panel; the host opens it in the browser if it is `https:`. */
export interface OpenLinkMessage {
	type: 'openLink';
	url: string;
}

/**
 * What the desktop shell takes from the view for itself. The controller never sees these — they
 * are about the window around the repository, not the repository — so they are not part of
 * {@link WebviewToHost}.
 */
export type DesktopViewMessage = CredentialReplyMessage | SaveMarkdownMessage | OpenLinkMessage;

export const LIST_DESKTOP_VIEW_MESSAGE_TYPES = [
	'credentialReply',
	'saveMarkdown',
	'openLink',
] as const satisfies readonly DesktopViewMessage['type'][];

export function isDesktopViewMessage(message: unknown): message is DesktopViewMessage {
	if (typeof message !== 'object' || message === null) return false;
	const { type } = message as { type?: unknown };
	return (LIST_DESKTOP_VIEW_MESSAGE_TYPES as readonly unknown[]).includes(type);
}

/** Cherry-pick commits in the order the cherry-pick editor left them. */
export interface CherryPickCommitsMessage {
	type: 'cherryPickCommits';
	/** See `MultiCommitActionMessage.repoPath`. */
	repoPath: string;
	/** In the order they are applied. */
	listHashes: string[];
	/** `-x`: note the commit each pick came from in its message. */
	recordOrigin: boolean;
	/** `--no-commit`: leave the changes staged instead of committing them. */
	noCommit: boolean;
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
export type BranchActionId = 'mergeInto' | 'rebaseOnto' | 'fastForward' | 'resetTo' | 'pushTo';

export interface BranchActionMessage {
	type: 'branchAction';
	/**
	 * The repository this action was created against — required, and the host refuses the
	 * action when it does not match the active repository. A menu or dialog built over one
	 * repo must not run over another that was switched to while it sat open.
	 */
	repoPath: string;
	action: BranchActionId;
	/**
	 * The dragged branch as git should be handed it: a local name, or the full
	 * `refs/remotes/<remote>/<branch>` path — never the joined `origin/main` short form, which a
	 * remote named with a slash or a leading dash makes ambiguous or dangerous.
	 */
	source: string;
	/** The same branch as the user saw it named, for prompts and confirmations. */
	sourceLabel: string;
	/**
	 * The branch dropped onto: a local name — or, with `targetRemote`, the branch's name on that
	 * remote, for the two actions that write no remote-tracking ref here (rebase onto it, push to it).
	 */
	target: string;
	targetRemote?: string;
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
	| 'ignore'
	| 'ignoreAndUntrack'
	| 'stash'
	| 'commit'
	| 'amend'
	| 'undoCommit'
	| 'restoreFromCommit'
	| 'applyFromStash'
	| 'stashFile'
	| 'takeOurs'
	| 'takeTheirs'
	| 'restoreConflict'
	| 'openMergeEditor';

export type RepoActionId =
	| 'fetch'
	| 'push'
	| 'pushForce'
	/** Plain `git pull`: whatever `pull.ff` / `pull.rebase` say for this repository. */
	| 'pull'
	| 'pullRebase'
	/** `--ff-only`: refuses rather than write a merge commit. */
	| 'pullFf'
	/** `--ff --no-rebase`: git's own default, stated so a repository's `pull.ff false` cannot undo it. */
	| 'pullFfIfPossible';

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
	/**
	 * The commit `restoreFromCommit` takes the file from; for `applyFromStash`, the stash — or its
	 * untracked-files parent, for a file that was untracked when stashed.
	 */
	hash?: string;
	/** `commit` / `amend`: run with `--no-verify`, skipping the repository's hooks this once. */
	noVerify?: boolean;
	/** `commit`: push once the commit is made, the way the Push button would. */
	pushAfter?: boolean;
}

export interface RemoteInfo {
	name: string;
	fetchUrl: string;
	/** Only when it differs from the fetch URL. */
	pushUrl?: string;
}

/** One of the repository's worktrees, as `git worktree list` reports it. */
export interface WorktreeInfo {
	path: string;
	/** The commit checked out there; null for a bare entry. */
	head: string | null;
	/** The branch checked out there, short name; null when detached or bare. */
	branch: string | null;
	/** The worktree holding the repository's own `.git` directory — the one that cannot be removed. */
	isMain: boolean;
	/** The worktree this window has open. */
	isCurrent: boolean;
	locked: boolean;
	/** Its folder is gone; `git worktree prune` forgets it. */
	prunable: boolean;
}

export interface LoadWorktreesMessage {
	type: 'loadWorktrees';
}

export interface WorktreesMessage {
	type: 'worktrees';
	listWorktrees: WorktreeInfo[];
}

/** One ref in the side panel; `hash` is the commit it points at (annotated tags peeled to their commit). */
export interface RefPanelRef {
	/** Short name: `feature/x` (local), `origin/feature/x` (remote), `v1.0` (tag). */
	name: string;
	hash: string;
}

export interface RefPanelRemoteRef extends RefPanelRef {
	/** The remote's name, e.g. `origin`. */
	remote: string;
}

export interface RefPanelStash {
	/** `stash@{0}` */
	selector: string;
	hash: string;
	message: string;
}

export interface RefPanelData {
	listLocal: RefPanelRef[];
	listRemote: RefPanelRemoteRef[];
	listTags: RefPanelRef[];
	listStashes: RefPanelStash[];
	/** The checked-out branch's short name; null when detached. */
	current: string | null;
}

/** View -> host: send the side panel's refs now, and again after every reload of the graph. */
export interface LoadRefPanelMessage {
	type: 'loadRefPanel';
}

export interface RefPanelMessage {
	type: 'refPanel';
	repoPath: string;
	data: RefPanelData;
}

/** Open, add, remove or prune worktrees. */
export interface WorktreeActionMessage {
	type: 'worktreeAction';
	/** See `RemoteActionMessage.repoPath`. */
	repoPath: string;
	action: 'open' | 'add' | 'remove' | 'prune';
	/** `open` / `remove`: the worktree. `add`: where to put it — absent, the host asks. */
	path?: string;
	/** `add`: checked out there when it exists, otherwise created from HEAD. */
	branch?: string;
}

/** List the repository's remotes. */
export interface LoadRemotesMessage {
	type: 'loadRemotes';
}

export interface RemotesMessage {
	type: 'remotes';
	listRemotes: RemoteInfo[];
}

/** The keys the Signing tab reads, as `git config --get-regexp` names them (lowercased). */
export const LIST_SIGNING_KEYS = [
	'commit.gpgsign',
	'tag.gpgsign',
	'gpg.format',
	'user.signingkey',
	'gpg.ssh.allowedsignersfile',
	'gpg.program',
	'gpg.ssh.program',
] as const;
export type SigningKey = (typeof LIST_SIGNING_KEYS)[number];
/** The ones the tab writes — the two program paths are only checked, never set from here. */
export const LIST_WRITABLE_SIGNING_KEYS = [
	'commit.gpgsign',
	'tag.gpgsign',
	'gpg.format',
	'user.signingkey',
	'gpg.ssh.allowedsignersfile',
] as const satisfies readonly SigningKey[];
export type WritableSigningKey = (typeof LIST_WRITABLE_SIGNING_KEYS)[number];

export interface SigningConfigValue {
	/** As written; a bare `key` with no `=` (git's "true") reads as an empty string with `bare`. */
	value: string;
	bare?: boolean;
	/** `local`, `global`, `system`, `worktree` or `command`. */
	scope: string;
	/** The file the value came from, e.g. `/Users/me/.gitconfig`. */
	origin: string;
}

/** Read the repository's signing config. */
export interface LoadSigningMessage {
	type: 'loadSigning';
}

export interface SigningMessage {
	type: 'signing';
	repoPath: string | null;
	/** The effective value of each key that is set anywhere. */
	mapValues: Partial<Record<SigningKey, SigningConfigValue>>;
	/** Whether this repository's own config sets the key, whatever wins. */
	listLocalKeys: SigningKey[];
	/** e.g. "2.54.0", or null when `git --version` could not be read. */
	gitVersion: string | null;
}

/** Write signing keys to the repository's config; null removes the repository's own value. */
export interface SigningActionMessage {
	type: 'signingAction';
	/** See `RemoteActionMessage.repoPath`. */
	repoPath: string;
	mapValues: Partial<Record<WritableSigningKey, string | null>>;
}

/** Add a remote (and fetch it), or remove one. */
export interface RemoteActionMessage {
	type: 'remoteAction';
	/**
	 * The repository this action was created against — required, and the host refuses the
	 * action when it does not match the active repository.
	 */
	repoPath: string;
	action: 'add' | 'remove';
	name: string;
	/** `add` only. */
	url?: string;
}

export type RebaseStepAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';

/** One commit of an interactive rebase, in the order the rebase applies them. */
export interface RebaseStep {
	hash: string;
	action: RebaseStepAction;
	/** `reword` only: the whole new message. */
	message?: string;
}

/** The commits after `base` up to HEAD, oldest first, for the interactive rebase editor. */
export interface LoadRebaseTodoMessage {
	type: 'loadRebaseTodo';
	base: string;
	/** The local branch to rewrite onto `base`; absent rewrites HEAD's commits after `base`. */
	branch?: string;
}

export interface RebaseTodoCommit {
	hash: string;
	subject: string;
	/** The full message, so a reword starts from all of it, not just the subject. */
	message: string;
	author: string;
}

export interface RebaseTodoMessage {
	type: 'rebaseTodo';
	base: string;
	branch?: string;
	listCommits: RebaseTodoCommit[];
	/** Why the commits cannot be rewritten from this base; the editor shows it instead. */
	error?: string;
}

export interface InteractiveRebaseMessage {
	type: 'interactiveRebase';
	/**
	 * The repository this action was created against — required, and the host refuses the
	 * action when it does not match the active repository.
	 */
	repoPath: string;
	base: string;
	/** See `LoadRebaseTodoMessage.branch`. */
	branch?: string;
	listSteps: RebaseStep[];
}

/** Read the repository's `commit.template`, to start a commit message from. */
export interface LoadCommitTemplateMessage {
	type: 'loadCommitTemplate';
}

export interface CommitTemplateMessage {
	type: 'commitTemplate';
	/** The template with its comment lines removed; null when none is configured or readable. */
	text: string | null;
}

/** One changed line picked in the diff view, identified by position and by text. */
export interface SelectedDiffLine {
	kind: 'add' | 'del';
	oldLine: number | null;
	newLine: number | null;
	text: string;
}

/** Which part of a working-tree file a diff shows, and so what a line taken from it can be moved by. */
export type WorkingDiffSide = 'unstaged' | 'staged';

/**
 * Stage, unstage or discard some lines of one file. The host reads the file's diff again and
 * refuses when the lines no longer match — the view may be showing a diff that is out of date.
 */
export interface StageLinesMessage {
	type: 'stageLines';
	/**
	 * The repository this action was created against — required, and the host refuses the
	 * action when it does not match the active repository.
	 */
	repoPath: string;
	path: string;
	side: WorkingDiffSide;
	action: 'stage' | 'unstage' | 'discard';
	listLines: SelectedDiffLine[];
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
	/**
	 * The repository this action was created against — required, and the host refuses the
	 * action when it does not match the active repository. A menu or dialog built over one
	 * repo must not run over another that was switched to while it sat open.
	 *
	 * A view fills this from the repository it is showing, falling back to the one the last
	 * `identity` reply was read from — the two agree, and the fallback is what keeps an action taken
	 * before the first `commits` reply from being refused.
	 */
	repoPath: string;
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

/**
 * Deliberately carries no `repoPath`: the saved list is a global setting and no repository is
 * touched, so there is nothing to stamp and nothing a stale stamp could protect. Guarding it would
 * only discard an account the user typed while the repository changed under an open dialog.
 */
export interface SaveIdentitiesMessage {
	type: 'saveIdentities';
	listIdentities: GitIdentity[];
}

/** Ask for every workspace repository's effective identity (sent when settings open). */
export interface LoadWorkspaceIdentitiesMessage {
	type: 'loadWorkspaceIdentities';
}

export interface WorkspaceIdentityEntry {
	repoPath: string;
	repoName: string;
	/** Effective values, null when unset. */
	name: string | null;
	email: string | null;
	/** True when the repo's local config overrides the global identity. */
	overridden: boolean;
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

/**
 * A question the host asks the webview to render with the product's own dialogs (see
 * feature-040). Payloads are declarative data; the webview answers with `uiReply` carrying the
 * same single-use `requestId`, or the host withdraws the question with `uiDismiss`.
 */
export type UiRequestPayload =
	| {
			kind: 'confirm';
			title: string;
			message: string;
			confirmLabel?: string;
			danger?: boolean;
	  }
	| {
			kind: 'pick';
			title: string;
			listOptions: { id: string; label: string; description?: string; picked?: boolean }[];
			multi?: boolean;
	  }
	| {
			kind: 'text';
			title: string;
			prompt?: string;
			value?: string;
			multiline?: boolean;
			required?: boolean;
	  };

export interface UiRequestMessage {
	type: 'uiRequest';
	/** Random, single-use; a reply must echo it exactly and is accepted once. */
	requestId: string;
	payload: UiRequestPayload;
}

export interface UiReplyMessage {
	type: 'uiReply';
	requestId: string;
	/** For kind 'confirm'. */
	confirmed?: boolean;
	/** For kind 'pick': selected option ids. */
	listSelected?: string[];
	/** For kind 'text'. */
	text?: string;
	/** Dismissed without an answer (Esc, close, repo switch). */
	cancelled?: boolean;
}

export interface UiDismissMessage {
	type: 'uiDismiss';
	requestId: string;
}

/**
 * AI commit (feature 053). The agent CLI is a pure text generator: the webview asks the host to
 * detect and choose an agent, then to generate or execute a commit plan. Every git mutation stays
 * in the host's own services — the agent never touches the repository.
 */
export const LIST_AGENT_IDS = ['claude', 'codex', 'gemini', 'copilot', 'opencode', 'qwen'] as const;
export type AgentId = (typeof LIST_AGENT_IDS)[number];

export interface AgentInfo {
	id: AgentId;
	label: string;
	/** First line of `--version`, when the binary was found. */
	version?: string;
	state: 'ready' | 'missing';
}

/** Ask the host which agent CLIs exist on PATH (opens or refreshes the picker). */
export interface DetectAgentsMessage {
	type: 'detectAgents';
}

/** Persist the chosen agent. Sending it is also the record of the user's diff-consent. */
export interface SelectAgentMessage {
	type: 'selectAgent';
	agentId: AgentId;
}

/** What an AI explanation is about. */
export type ExplainTarget =
	| { kind: 'commit'; hash: string }
	/** `ref` is what git is handed (`refs/heads/x`, `refs/remotes/origin/x`); `label` names it. */
	| { kind: 'branch'; ref: string; label: string }
	/** Everything not committed yet: staged, unstaged and untracked. */
	| { kind: 'working' };

/** Hand a commit, a branch or the working changes to the chosen agent CLI and show its account. */
export interface AiExplainMessage {
	type: 'aiExplain';
	/** See `MultiCommitActionMessage.repoPath`. */
	repoPath: string;
	target: ExplainTarget;
}

export interface GenerateCommitPlanMessage {
	type: 'generateCommitPlan';
	/**
	 * The repository this action was created against — required, and the host refuses the
	 * action when it does not match the active repository.
	 */
	repoPath: string;
	/**
	 * Stage everything before reading the tree — the "Stage all & continue" answer to starting an
	 * AI commit with nothing staged.
	 *
	 * Carried on this message rather than sent as a separate `workingTreeAction` because the two
	 * halves have to happen in that order: `git add -A` takes `.git/index.lock`, generation's
	 * `git status` refreshes the index, and nothing in the host orders two independent messages.
	 * Sent apart, they raced — the status could report nothing staged, or the add could lose the
	 * lock and fail outright.
	 */
	stageAll?: boolean;
}

export interface CancelCommitPlanMessage {
	type: 'cancelCommitPlan';
	repoPath: string;
}

/**
 * Ask what the host knows about this repository's AI commit plan. The generation itself lives
 * host-side (the agent process outlives any webview), so a freshly created view asks this to
 * pick up a run still in flight or a result that arrived while no view was there to hear it.
 */
export interface LoadCommitPlanStateMessage {
	type: 'loadCommitPlanState';
	repoPath: string;
}

/** One commit to create: the files to stage and the full message (`subject[\n\nbody]`). */
export interface CommitPlanGroup {
	listFiles: string[];
	message: string;
}

export interface ExecuteCommitPlanMessage {
	type: 'executeCommitPlan';
	/**
	 * The repository this action was created against — required, and the host refuses the
	 * action when it does not match the active repository.
	 */
	repoPath: string;
	nonce: number;
	/** Committed in order; the host stops at the first failure and reports how far it got. */
	listGroups: CommitPlanGroup[];
}

export interface AgentInventoryMessage {
	type: 'agentInventory';
	listAgents: AgentInfo[];
	/** The agent picked last time, or null before any pick. */
	savedAgentId: AgentId | null;
	/** Whether the user has already accepted that their diff is sent to an agent. */
	consented: boolean;
	/** Per-agent model pin from settings; empty string = the CLI's own default. */
	mapModels: Partial<Record<AgentId, string>>;
	/** Per-agent thinking/effort level from settings; empty string = the CLI's own default. */
	mapThinking: Partial<Record<AgentId, string>>;
	/** Language the AI writes commits in; empty string = follow the repository's recent subjects. */
	language: string;
}

/** Save the AI-commit preferences from the settings tab; answered with a fresh inventory. */
export interface SaveAiSettingsMessage {
	type: 'saveAiSettings';
	/** Also switch to this agent (and record consent); absent = keep the current one. */
	agentId?: AgentId;
	mapModels: Partial<Record<AgentId, string>>;
	mapThinking: Partial<Record<AgentId, string>>;
	/** Absent = leave the language as it is; empty string = follow the recent subjects. */
	language?: string;
}

/** What the agent proposed: the whole change as one commit, and (optionally) a split. */
export interface CommitPlanDraft {
	listGroups: { listFiles: string[]; subject: string; body?: string }[];
	single: { subject: string; body?: string };
}

/**
 * How far a generation in flight has come. 'collected' = the changed files are known;
 * 'prompted' = diffs are gathered and redacted, the agent is now writing. The counts ride on
 * the stage that produced them.
 */
export interface CommitPlanProgress {
	stage: 'collected' | 'prompted';
	fileCount: number;
	additions?: number;
	deletions?: number;
}

/** Broadcast while a generation runs, so every open view can show the same step list. */
export interface CommitPlanProgressMessage {
	type: 'commitPlanProgress';
	repoPath: string;
	generationId: number;
	progress: CommitPlanProgress;
}

export interface CommitPlanResultMessage {
	type: 'commitPlanResult';
	repoPath: string;
	/**
	 * Host-issued and monotonic, replacing any webview-side counter: it stays comparable across
	 * webview reloads, which an in-memory nonce cannot.
	 */
	generationId: number;
	plan?: CommitPlanDraft;
	error?: string;
	/** The CLI refused for want of a login — the dialog offers a terminal instead of a retry. */
	needsLogin?: boolean;
}

/** The answer to {@link LoadCommitPlanStateMessage}: what the host holds for this repository. */
export interface CommitPlanStateMessage {
	type: 'commitPlanState';
	repoPath: string;
	status: 'idle' | 'running' | 'done';
	/** Present unless idle. */
	generationId?: number;
	/** The latest progress of a run still in flight, so a rehydrating view catches up mid-run. */
	progress?: CommitPlanProgress;
	/** The cached result, present when status is 'done' — the same fields the broadcast carried. */
	plan?: CommitPlanDraft;
	error?: string;
	needsLogin?: boolean;
}

export interface CommitPlanExecutedMessage {
	type: 'commitPlanExecuted';
	nonce: number;
	/** Commits actually created before the run finished or stopped. */
	committed: number;
	total: number;
	error?: string;
}

/** Messages sent from the webview to the extension host. */
/** Put the repository back the way it was before the last action that changed it. */
export interface UndoActionMessage {
	type: 'undoAction';
	/**
	 * The repository this action was created against — required, and the host refuses the
	 * action when it does not match the active repository.
	 */
	repoPath: string;
}

/**
 * What pressing Undo would undo, as a phrase to finish "Undo …" with — or null when there is
 * nothing recorded. Sent after every action, so the button never offers a stale promise.
 */
export interface RedoActionMessage {
	type: 'redoAction';
	repoPath: string;
}

export interface UndoStateMessage {
	type: 'undoState';
	/** What Redo would redo — the action just undone; null when there is nothing to redo. */
	redoLabel?: string | null;
	label: string | null;
}

export type WebviewToHost =
	| LoadCommitsMessage
	| SelectRepoMessage
	| LoadCommitDetailsMessage
	| LoadComparisonMessage
	| LoadFileDiffMessage
	| LoadFileHistoryMessage
	| LoadBlameMessage
	| LoadCommitStatsMessage
	| LoadCommitTemplateMessage
	| LoadRemotesMessage
	| RemoteActionMessage
	| LoadSigningMessage
	| SigningActionMessage
	| LoadWorktreesMessage
	| LoadRefPanelMessage
	| WorktreeActionMessage
	| LoadRebaseTodoMessage
	| InteractiveRebaseMessage
	| OpenDiffMessage
	| OpenCompareDiffMessage
	| CommitActionMessage
	| SquashCommitsMessage
	| MultiCommitActionMessage
	| CherryPickCommitsMessage
	| ViewFocusMessage
	| HostNoticeReplyMessage
	| HostProgressCancelMessage
	| SequencerActionMessage
	| BranchActionMessage
	| CheckFastForwardMessage
	| WorkingTreeActionMessage
	| StageLinesMessage
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
	| LoadWorkspaceIdentitiesMessage
	| LoadBranchInventoryMessage
	| CleanupBranchesMessage
	| UiReplyMessage
	| DetectAgentsMessage
	| SelectAgentMessage
	| UndoActionMessage
	| RedoActionMessage
	| SaveAiSettingsMessage
	| GenerateCommitPlanMessage
	| AiExplainMessage
	| CancelCommitPlanMessage
	| LoadCommitPlanStateMessage
	| ExecuteCommitPlanMessage;

/** An operation paused mid-flight (usually on conflicts), waiting to be continued or aborted. */
export type RepoState = 'rebasing' | 'merging' | 'cherryPicking' | 'reverting';

export interface CommitsMessage {
	type: 'commits';
	/** `.gitattributes` patterns that LFS stores (committed at HEAD); absent when there are none. */
	lfsPatterns?: string[];
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
	/**
	 * HEAD points at a branch with no commits yet. Distinct from `currentBranch: null`, which is a
	 * detached HEAD — the opposite state, and the only one that has no branch name to show.
	 */
	isUnborn: boolean;
	/**
	 * The branch HEAD was on before the last checkout (`@{-1}`), or null when there is no such
	 * entry. Only read while detached, where it is the way back.
	 */
	previousBranch: string | null;
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
	 * HEAD points at a branch with no commits yet. Distinct from `currentBranch: null`, which is a
	 * detached HEAD — the opposite state, and the only one that has no branch name to show.
	 */
	isUnborn: boolean;
	previousBranch: string | null;
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
	/**
	 * The repository this identity was read from, or null when there is none. A view that has not
	 * had its first `commits` reply yet does not know which repository it is showing — this is what
	 * lets it still stamp an identity action correctly.
	 */
	repoPath: string | null;
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

/**
 * How the editor draws code, so the diff panel draws it the same way: the columns one tab spans.
 * Sent on webview startup and again whenever the user changes the setting.
 */
export interface EditorPrefsMessage {
	type: 'editorPrefs';
	tabSize: number;
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

export interface WorkspaceIdentitiesMessage {
	type: 'workspaceIdentities';
	listRepos: WorkspaceIdentityEntry[];
}

/** Messages sent from the extension host to the webview. */
export type HostToWebview =
	| CommitsMessage
	| HostCommandMessage
	| CapabilitiesMessage
	| HostNoticeMessage
	| HostProgressMessage
	| CredentialRequestMessage
	| CredentialCancelMessage
	| ShowMarkdownMessage
	| CommitOutcomeMessage
	| CommitStatsMessage
	| StatusUpdateMessage
	| CommitDetailsMessage
	| ComparisonMessage
	| FileDiffMessage
	| FileHistoryMessage
	| BlameMessage
	| CommitTemplateMessage
	| RemotesMessage
	| SigningMessage
	| WorktreesMessage
	| RefPanelMessage
	| RebaseTodoMessage
	| ViewSettingsMessage
	| FileIconsMessage
	| ColorThemeMessage
	| EditorPrefsMessage
	| IdentityMessage
	| WorkspaceIdentitiesMessage
	| FastForwardCheckMessage
	| RevealCommitMessage
	| BranchInventoryMessage
	| BranchCleanupResultMessage
	| UiRequestMessage
	| UiDismissMessage
	| ErrorMessage
	| AgentInventoryMessage
	| CommitPlanProgressMessage
	| CommitPlanResultMessage
	| CommitPlanStateMessage
	| CommitPlanExecutedMessage
	| UndoStateMessage;
