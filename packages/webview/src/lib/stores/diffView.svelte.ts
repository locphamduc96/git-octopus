import type { BlameCommit, DiffHunk, WorkingDiffSide } from '@git-octopus/shared';
import { postToHost } from '../bridge';
import { buildDiffKey, isCacheableDiffKey, rightRevision } from '../diffKey';
import { onHostType, onRepoReset } from '../hostRouter';
import { langForPath, tokenizeHunks, type HighlightToken, type ColorThemeKind } from '../highlight';
import { prefs } from './prefs.svelte';
import type { DiffLayout } from '../diffRows';

/**
 * The file the diff panel is showing, in place of the graph. Null whenever the graph is up —
 * including when diffs are set to open in a VS Code editor instead.
 */
export interface DiffTargetState {
	path: string;
	/** The path before a rename, so the diff reads old → new instead of a whole-file add. */
	oldPath?: string;
	title: string;
	hash?: string;
	fromHash?: string;
	toHash?: string;
	untracked?: boolean;
	/** A working-tree file: only its unstaged or only its staged part. */
	side?: WorkingDiffSide;
	/** Show the whole file at the right-hand revision, each line credited to its commit. */
	blame?: boolean;
}

export interface BlameData {
	listLineHashes: string[];
	mapCommits: Record<string, BlameCommit>;
}

let target = $state<DiffTargetState | null>(null);
let listHunks = $state<DiffHunk[]>([]);
let notice = $state<string | null>(null);
let loading = $state(false);
/** True only while the diff is animating away — it is still drawn, so it must stop taking clicks. */
let closing = $state(false);
/** Identifies the request in flight, so a reply for a file already navigated away from is dropped. */
let key = $state('');
let blame = $state<BlameData | null>(null);
/** Diffs already fetched this session, keyed the same way. Prev/next then costs no git call. */
const mapDiffCache = new Map<string, { listHunks: DiffHunk[]; notice?: string }>();

/** Dark or light, told by the host; guessed from the body classes until that message arrives. */
let themeKind = $state<ColorThemeKind>('dark');
/** Per-line syntax tokens for the open diff, or null while Shiki is not ready for it. */
let listTokens = $state<HighlightToken[][] | null>(null);
/** Tokens per diff and theme, so revisiting a file or flipping the theme back is instant. */
const mapDiffTokenCache = new Map<string, HighlightToken[][]>();
/** Above this the whole-file view of a big file would hang the webview on tokenizing. */
const MAX_HIGHLIGHT_LINES = 20_000;
/** Context lines: the whole-file view asks for more than any file could have. */
const FULL_CONTEXT = 1_000_000;

function request(next: DiffTargetState): void {
	blame = null;
	if (next.blame) {
		requestBlame(next);
		return;
	}
	const context = prefs.settings.diffMode === 'full' ? FULL_CONTEXT : 3;
	const ignoreWhitespace = prefs.settings.diffIgnoreWhitespace;
	const nextKey = buildDiffKey(next, context, ignoreWhitespace);
	key = nextKey;
	const cached = mapDiffCache.get(nextKey);
	if (cached) {
		listHunks = cached.listHunks;
		notice = cached.notice ?? null;
		loading = false;
		return;
	}
	listHunks = [];
	notice = null;
	loading = true;
	postToHost({
		type: 'loadFileDiff',
		key: nextKey,
		path: next.path,
		oldPath: next.oldPath,
		hash: next.hash,
		fromHash: next.fromHash,
		toHash: next.toHash,
		untracked: next.untracked,
		side: next.side,
		context,
		ignoreWhitespace,
	});
}

/** The open diff was fetched with the old context count, so it has to be asked for again. */
/**
 * Blame is not cached: at a commit it could be, but the working-tree copy changes under it, and one
 * file's blame is a single quick read either way.
 */
function requestBlame(next: DiffTargetState): void {
	const rev = rightRevision(next);
	key = `blame|${rev ?? ''}|${next.path}`;
	listHunks = [];
	if (rev === undefined) {
		notice = 'An untracked file has no history to blame.';
		loading = false;
		return;
	}
	notice = null;
	loading = true;
	postToHost({ type: 'loadBlame', key, path: next.path, ...(rev ? { rev } : {}) });
}

function refresh(): void {
	if (target) request(target);
}

onHostType('fileDiff', (message) => {
	if (isCacheableDiffKey(message.key)) {
		mapDiffCache.set(message.key, { listHunks: message.listHunks, notice: message.notice });
	}
	// A reply for a file the user has already stepped past would otherwise overwrite the one they
	// are looking at now.
	if (message.key !== key) return;
	listHunks = message.listHunks;
	notice = message.notice ?? null;
	loading = false;
});

/**
 * The file arrives as lines; it is drawn as one hunk of unchanged lines, so the diff panel's own
 * virtualising, highlighting and wrapping serve it unchanged.
 */
onHostType('blame', (message) => {
	if (message.key !== key) return;
	listHunks =
		message.listLines.length === 0
			? []
			: [
					{
						oldStart: 1,
						newStart: 1,
						heading: '',
						listLines: message.listLines.map((text, index) => ({
							kind: 'context' as const,
							text,
							oldLine: index + 1,
							newLine: index + 1,
						})),
					},
				];
	blame = { listLineHashes: message.listLineHashes, mapCommits: message.mapCommits };
	notice = message.notice ?? null;
	loading = false;
});

onHostType('colorTheme', (message) => {
	themeKind = message.kind;
});

onRepoReset(() => {
	target = null;
});

export const diffView = {
	get target(): DiffTargetState | null {
		return target;
	},
	get listHunks(): DiffHunk[] {
		return listHunks;
	},
	get listTokens(): HighlightToken[][] | null {
		return listTokens;
	},
	get notice(): string | null {
		return notice;
	},
	get loading(): boolean {
		return loading;
	},
	get closing(): boolean {
		return closing;
	},
	get key(): string {
		return key;
	},
	get blame(): BlameData | null {
		return blame;
	},
	get themeKind(): ColorThemeKind {
		return themeKind;
	},
	/** The body classes are the only guess available before the host says which theme is on. */
	setThemeKind(kind: ColorThemeKind): void {
		themeKind = kind;
	},
	show(next: DiffTargetState): void {
		target = next;
		request(next);
	},
	close(): void {
		target = null;
	},
	setClosing(value: boolean): void {
		closing = value;
	},
	refresh,
	setMode(mode: 'compact' | 'full'): void {
		prefs.setSettings({ ...prefs.settings, diffMode: mode });
		refresh();
	},
	/** Swap between the diff and the blame of the same file at the same revision. */
	toggleBlame(): void {
		if (!target) return;
		target = { ...target, blame: !target.blame };
		request(target);
	},
	/** The layout and wrapping only redraw what is already loaded. */
	setLayout(layout: DiffLayout): void {
		prefs.setSettings({ ...prefs.settings, diffLayout: layout });
	},
	toggleWrap(): void {
		prefs.setSettings({ ...prefs.settings, diffWrap: !prefs.settings.diffWrap });
	},
	/** Whitespace changes what git returns, so the diff is asked for again. */
	toggleIgnoreWhitespace(): void {
		prefs.setSettings({
			...prefs.settings,
			diffIgnoreWhitespace: !prefs.settings.diffIgnoreWhitespace,
		});
		refresh();
	},
	/** The host could not produce this diff; the panel says so instead of the graph. */
	failed(message: string): void {
		loading = false;
		notice = message;
	},
	/**
	 * Tokenize the open diff in the background. The panel renders plain text immediately and the
	 * coloured spans swap in when Shiki has the grammar.
	 *
	 * Every input is passed in, because the caller is an effect in `App` and those reads are what
	 * decide when this runs again: keyed off the diff key, so scrolling (which only changes the
	 * visible slice) never re-tokenizes. The freshness check at the end deliberately reads the live
	 * state rather than the arguments — a result landing after the user moved on is dropped.
	 */
	tokenize(
		forKey: string,
		kind: ColorThemeKind,
		path: string | null,
		listForHunks: DiffHunk[]
	): void {
		listTokens = null;
		if (!path || listForHunks.length === 0) return;
		const lang = langForPath(path);
		if (!lang) return;
		const cacheKey = `${forKey}@${kind}`;
		const cached = mapDiffTokenCache.get(cacheKey);
		if (cached) {
			listTokens = cached;
			return;
		}
		const listHunkTexts = listForHunks.map((hunk) => hunk.listLines.map((line) => line.text));
		if (
			listHunkTexts.reduce((total, listTexts) => total + listTexts.length, 0) > MAX_HIGHLIGHT_LINES
		)
			return;
		void tokenizeHunks(lang, listHunkTexts, kind).then((listNext) => {
			if (!listNext) return;
			if (isCacheableDiffKey(forKey)) mapDiffTokenCache.set(cacheKey, listNext);
			if (forKey === key && kind === themeKind) listTokens = listNext;
		});
	},
};
