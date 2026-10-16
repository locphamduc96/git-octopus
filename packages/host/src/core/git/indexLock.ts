/**
 * Which commands contend for `.git/index.lock`, and how.
 *
 * Measured on git 2.50.1 by holding the lock and running each command (feature 075 §1.1), because
 * the split is not guessable from the command's name: `stash push` writes the index while
 * `stash list` never touches it, `merge` writes it while `merge-base` does not, and `clean` — which
 * deletes files — never takes it at all.
 *
 * Two different consequences, so two different predicates:
 *
 * - `writesIndex` — the command takes the lock *mandatorily* and dies with
 *   `fatal: Unable to create … index.lock: File exists` when it cannot. These are what a queue has
 *   to serialize, because two of them overlapping means one of them fails outright.
 * - `skipsOptionalLocks` — the command only wants the lock to write back a refreshed stat cache,
 *   and silently does without when it is held. Nothing fails, but every one of these rewrites
 *   `.git/index`, which `RepoWatcher` is watching — the extension's own reads wake its own watcher.
 */

/** Global options that come before the subcommand, and whether each one swallows the next argv. */
const MAP_GLOBAL_OPTION_ARITY: Record<string, number> = {
	'-c': 1,
	'-C': 1,
	'--git-dir': 1,
	'--work-tree': 1,
	'--namespace': 1,
	'--exec-path': 1,
	'--no-optional-locks': 0,
	'--no-pager': 0,
	'--literal-pathspecs': 0,
	'--bare': 0,
};

/**
 * The subcommand, looking past any leading global options. `git -c core.editor=true rebase
 * --continue` is a rebase, not a `-c`; the sequencer builds exactly that form.
 */
export function subcommandOf(args: string[]): string | undefined {
	let index = 0;
	while (index < args.length) {
		const token = args[index];
		if (!token.startsWith('-')) return token;
		// A bare `--git-dir` eats the next argv; `--git-dir=x` carries its value inline, and so does
		// every unrecognised flag we skip over — git takes no separated values we do not list here.
		index += 1 + (MAP_GLOBAL_OPTION_ARITY[token] ?? 0);
	}
	return undefined;
}

/** Subcommands that always take the index lock, whatever their arguments. */
const SET_ALWAYS_WRITES = new Set([
	'add',
	'reset',
	'commit',
	'checkout',
	'restore',
	'switch',
	'rm',
	'mv',
	'cherry-pick',
	'revert',
	'rebase',
	'merge',
	'pull',
	'apply',
	'am',
	'update-index',
	'read-tree',
]);

/**
 * `stash` is the one subcommand that splits: everything that moves work in or out of the index
 * takes the lock, while `list` and `show` are plain reads. A bare `git stash` is `push`.
 */
const SET_READONLY_STASH_VERBS = new Set(['list', 'show']);

/** Whether this command needs `.git/index.lock` and fails when it cannot have it. */
export function writesIndex(args: string[]): boolean {
	const subcommand = subcommandOf(args);
	if (subcommand === undefined) return false;
	if (subcommand === 'stash') {
		const verb = args[args.indexOf('stash') + 1];
		return verb === undefined || verb.startsWith('-') || !SET_READONLY_STASH_VERBS.has(verb);
	}
	return SET_ALWAYS_WRITES.has(subcommand);
}

/**
 * Writes that can simply be run again when another process held the lock.
 *
 * Measured on git 2.50.1 (feature 076 §1.2), every form this extension issues — `checkout -b`,
 * `--track`, `--detach`, `reset --hard/--mixed/--keep <other>`, `commit --amend`, `restore
 * --staged`, `rm --cached`, `mv` included: blocked by the lock, each dies with exit 128 before it
 * has moved a ref, HEAD, the index, a file, or a config entry, so a second attempt cannot double
 * anything. The forms that need no index write (`reset --soft`, `checkout -b` onto HEAD) just
 * succeed under a held lock.
 *
 * Left out: commands that take the lock more than once and can fail in between (`rebase`, `merge`,
 * `pull`, `cherry-pick`, `revert`, `am`), and `stash`, which fails with a different message.
 */
const SET_RETRIES_ON_LOCK = new Set([
	'add',
	'commit',
	'reset',
	'checkout',
	'restore',
	'switch',
	'rm',
	'mv',
]);

export function retriesOnLock(args: string[]): boolean {
	const subcommand = subcommandOf(args);
	return subcommand !== undefined && SET_RETRIES_ON_LOCK.has(subcommand);
}

/** The lock file a failure was blocked by, from git's own wording; null for any other failure. */
export function busyLockPath(message: string): string | null {
	return /Unable to create '(.+?\.lock)': File exists/.exec(message)?.[1] ?? null;
}

/**
 * Whether to run this command with the optional index refresh turned off.
 *
 * Only `status`. Measured: `status` honours `GIT_OPTIONAL_LOCKS=0` and stops rewriting the index,
 * but `git diff HEAD` ignores it and refreshes anyway (it goes through `refresh_index_quietly`), so
 * claiming the variable covers "reads" would be wrong — working-tree diffs go through `diff-index`
 * instead (see `workingTreeDiff.ts`). This is also exactly the scope VS Code's own Git extension
 * uses — it sets the variable on its status stream and on nothing else.
 *
 * Deliberately not applied to write commands: they take a real lock regardless, so there is nothing
 * to save, and the permanently stale stat cache it leaves behind makes every later status slower.
 */
export function skipsOptionalLocks(args: string[]): boolean {
	return subcommandOf(args) === 'status';
}
