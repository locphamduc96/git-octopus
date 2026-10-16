import type { GitExecutor } from '../core/git/GitExecutor.js';
import type { RepoContext } from '../app/useCases/loadCommits.js';
import type { RepoInfo } from '@git-octopus/shared';

/**
 * A git that answers from a script and remembers what it was asked.
 *
 * Most of what is worth pinning in this package is the argv — which ref form an action hands git,
 * whether a guard stopped a command from running at all, which flags a filter adds. None of that is
 * visible to a parser-level test, and a real repository cannot report it.
 *
 * Answers are matched by prefix against the joined argv, longest first, so a specific
 * `'diff-tree --name-status'` wins over a broad `'diff-tree'`.
 */
export class FakeGit implements GitExecutor {
	/** Every invocation, argv and the directory it ran in. */
	public readonly listInvocations: { args: string[]; cwd: string | undefined }[] = [];

	public readonly listCalls: string[][] = [];

	private readonly listRejects: { prefix: string; message: string }[] = [];

	public constructor(private readonly mapAnswers: Record<string, string> = {}) {}

	public run(args: string[], cwd?: string, listOkCodes?: number[]): Promise<string> {
		this.listInvocations.push({ args, cwd });
		this.listCalls.push(args);
		const argv = args.join(' ');

		const rejection = this.listRejects.find((entry) => argv.startsWith(entry.prefix));
		if (rejection) return Promise.reject(new Error(rejection.message));

		// `--no-index` exits 1 whenever the files differ, so a caller that did not declare 1 as an
		// acceptable code must see the same failure the real executor would raise.
		if (args.includes('--no-index') && !listOkCodes?.includes(1)) {
			return Promise.reject(new Error('git exited with code 1'));
		}

		const key = Object.keys(this.mapAnswers)
			.filter((prefix) => argv.startsWith(prefix))
			.sort((a, b) => b.length - a.length)[0];
		return Promise.resolve(key === undefined ? '' : this.mapAnswers[key]);
	}

	/** Make every command whose argv starts with `prefix` fail, the way a broken repo would. */
	public rejectOn(prefix: string, message = 'git failed'): this {
		this.listRejects.push({ prefix, message });
		return this;
	}

	/** Every command whose first word is `name`. */
	public callsTo(name: string): string[][] {
		return this.listCalls.filter((args) => args[0] === name);
	}

	public ran(name: string): boolean {
		return this.callsTo(name).length > 0;
	}

	/** Whether any command's argv contains `fragment` — for asserting a guard blocked a write. */
	public ranArgv(fragment: string): boolean {
		return this.listCalls.some((args) => args.join(' ').includes(fragment));
	}

	/** The directories a command matching `fragment` ran in — for asserting which repo was touched. */
	public cwdsFor(fragment: string): (string | undefined)[] {
		return this.listInvocations
			.filter((entry) => entry.args.join(' ').includes(fragment))
			.map((entry) => entry.cwd);
	}
}

export function fakeGit(mapAnswers: Record<string, string> = {}): FakeGit {
	return new FakeGit(mapAnswers);
}

const REPO_PATH = '/repo';

/**
 * A `RepoContext` for use-case tests. `pathExists` answers false by default — the sequencer files
 * it probes are absent in an idle repository.
 */
export function makeRepoContext(overrides: Partial<RepoContext> = {}): RepoContext {
	const listRepos: RepoInfo[] = [{ path: REPO_PATH, name: 'repo' }];
	return {
		executor: fakeGit(),
		repos: listRepos,
		cwd: REPO_PATH,
		repoName: 'repo',
		pathExists: () => Promise.resolve(false),
		...overrides,
	};
}
