import { beforeEach, describe, expect, it } from 'vitest';
import type { CommitActionMessage } from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import type { UserPrompt } from '../../app/ports/userPrompt.js';
import {
	CommitActionService,
	readHostViewSettings,
	type HostViewSettings,
} from './CommitActionService.js';
import { recorded, resetRecorded } from '../../test/vscodeStub.js';

/**
 * A git that answers from a script and remembers what it was asked.
 *
 * The point of these tests is the argv: which ref form an action hands git, and whether a guard
 * stopped a command from running at all. Both are invisible to a parser-level test.
 */
class FakeGit implements GitExecutor {
	public readonly listCalls: string[][] = [];

	public constructor(private readonly mapAnswers: Record<string, string> = {}) {}

	public run(args: string[]): Promise<string> {
		this.listCalls.push(args);
		const key = Object.keys(this.mapAnswers).find((prefix) => args.join(' ').startsWith(prefix));
		return Promise.resolve(key ? this.mapAnswers[key] : '');
	}

	/** Every command whose first word is `name`. */
	public callsTo(name: string): string[][] {
		return this.listCalls.filter((args) => args[0] === name);
	}

	public ran(name: string): boolean {
		return this.callsTo(name).length > 0;
	}
}

const SILENT_PROMPT: UserPrompt = {
	confirm: () => Promise.resolve(true),
	pickOptions: (request) => Promise.resolve(request.listOptions.map((option) => option.id)),
	inputText: () => Promise.resolve(undefined),
};

function makeMessage(partial: Partial<CommitActionMessage>): CommitActionMessage {
	return {
		type: 'commitAction',
		repoPath: '/repo',
		action: 'checkoutBranch',
		hash: '',
		subject: '',
		branches: [],
		remoteBranches: [],
		...partial,
	};
}

function makeService(git: FakeGit, settings: HostViewSettings | null = null): CommitActionService {
	return new CommitActionService(git, () => settings);
}

/** A local branch that exists and is three commits behind its remote, on a clean tree. */
const BEHIND: Record<string, string> = {
	'rev-parse --verify --quiet refs/heads/': 'abc123\n',
	'rev-list --count --left-right': '0\t3\n',
	'status --porcelain': '',
};

beforeEach(resetRecorded);

describe('readHostViewSettings', () => {
	it('reads the settings out of the shape the view actually persists', () => {
		// The whole preferences object, exactly as `savePreferences` writes it.
		const stored = {
			settings: { autoFastForwardOnCheckout: false },
			columns: { author: false, commit: false, date: true },
			fileView: 'tree',
			metaOpen: false,
		};
		expect(readHostViewSettings(stored)).toEqual({ autoFastForwardOnCheckout: false });
	});

	it('answers null for a blob with nothing saved in it yet', () => {
		expect(readHostViewSettings(null)).toBeNull();
		expect(readHostViewSettings({})).toBeNull();
		expect(readHostViewSettings('nonsense')).toBeNull();
	});
});

describe('checkout from a remote branch', () => {
	it('fast-forwards a branch that has only fallen behind', async () => {
		const git = new FakeGit(BEHIND);
		await makeService(git, { autoFastForwardOnCheckout: true }).run(
			makeMessage({ remoteBranches: [{ remote: 'origin', branch: 'wikz' }] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.callsTo('merge')).toEqual([['merge', '--ff-only', 'refs/remotes/origin/wikz']]);
	});

	it('does not fast-forward once the setting is off', async () => {
		// The defect this covers was invisible to `planCheckout`: the flag never reached it.
		const git = new FakeGit(BEHIND);
		await makeService(git, { autoFastForwardOnCheckout: false }).run(
			makeMessage({ remoteBranches: [{ remote: 'origin', branch: 'wikz' }] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('merge')).toBe(false);
		expect(git.callsTo('checkout')).toEqual([['checkout', 'wikz']]);
	});

	it('does not fast-forward when only untracked files are in the way', async () => {
		// `merge --ff-only` refuses rather than overwrite an untracked file, and the setting
		// promises it never runs over uncommitted work — which an untracked file is.
		const git = new FakeGit({ ...BEHIND, 'status --porcelain': '?? notes.txt\n' });
		await makeService(git, { autoFastForwardOnCheckout: true }).run(
			makeMessage({ remoteBranches: [{ remote: 'origin', branch: 'wikz' }] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('merge')).toBe(false);
		// It still asks git about untracked files rather than excluding them.
		expect(git.callsTo('status')[0]).not.toContain('--untracked-files=no');
	});

	it('addresses a remote whose name contains a slash by its full ref path', async () => {
		// `team/origin` + `main` joined and re-split at the first slash names the branch
		// `origin/main`, which is not a branch at all.
		const git = new FakeGit({ 'rev-parse --verify --quiet refs/heads/': '' });
		await makeService(git).run(
			makeMessage({ remoteBranches: [{ remote: 'team/origin', branch: 'main' }] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.callsTo('checkout')).toEqual([
			['checkout', '-b', 'main', '--track', 'refs/remotes/team/origin/main'],
		]);
	});

	it('never puts a dash-leading remote where an option could be read', async () => {
		const git = new FakeGit({ 'rev-parse --verify --quiet refs/heads/': '' });
		await makeService(git).run(
			makeMessage({ remoteBranches: [{ remote: '-evil', branch: 'main' }] }),
			'/repo',
			SILENT_PROMPT
		);
		for (const args of git.listCalls) {
			for (const arg of args.slice(1)) {
				// Only git's own flags may begin with a dash; nothing built from a remote's name.
				expect(arg.startsWith('-evil')).toBe(false);
			}
		}
	});
});

describe('remote branch commands', () => {
	it('separates options from a remote name when deleting a remote branch', async () => {
		const git = new FakeGit();
		await makeService(git).run(
			makeMessage({
				action: 'deleteRemoteBranch',
				remoteBranches: [{ remote: '-evil', branch: 'doomed' }],
			}),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.callsTo('push')).toEqual([
			['push', '--delete', '--end-of-options', '-evil', 'doomed'],
		]);
	});

	it('separates options from a remote name when fetching into a local branch', async () => {
		const git = new FakeGit();
		await makeService(git).run(
			makeMessage({
				action: 'fetchIntoLocal',
				remoteBranches: [{ remote: '-evil', branch: 'main' }],
			}),
			'/repo',
			SILENT_PROMPT
		);
		// Every option this prompt offers is accepted by the silent prompt, so the refspec is forced.
		expect(git.callsTo('fetch')).toEqual([['fetch', '--end-of-options', '-evil', '+main:main']]);
	});
});

describe('a ref two remotes could both own', () => {
	// `git remote` lists both, and their default refspecs write the same ref path. Acting means
	// picking one at random, so nothing acts.
	const OVERLAPPING = { remote: 'team/origin', branch: 'main' };
	const BOTH_REMOTES: Record<string, string> = { remote: 'team\nteam/origin\n' };

	it('refuses to check it out', async () => {
		const git = new FakeGit({ ...BEHIND, ...BOTH_REMOTES });
		await makeService(git).run(
			makeMessage({ remoteBranches: [OVERLAPPING] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('checkout')).toBe(false);
		expect(git.ran('merge')).toBe(false);
		expect(recorded.listErrors.join(' ')).toContain('team/origin or team');
	});

	it('refuses to fetch it into a local branch', async () => {
		const git = new FakeGit(BOTH_REMOTES);
		await makeService(git).run(
			makeMessage({ action: 'fetchIntoLocal', remoteBranches: [OVERLAPPING] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('fetch')).toBe(false);
	});

	it('refuses to delete it on the remote', async () => {
		const git = new FakeGit(BOTH_REMOTES);
		await makeService(git).run(
			makeMessage({ action: 'deleteRemoteBranch', remoteBranches: [OVERLAPPING] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('push')).toBe(false);
	});

	it('goes ahead once only one of the two remotes is configured', async () => {
		const git = new FakeGit({ ...BEHIND, remote: 'team/origin\n' });
		await makeService(git).run(
			makeMessage({ remoteBranches: [OVERLAPPING] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.callsTo('checkout')).toEqual([['checkout', 'main']]);
	});

	it('goes ahead for a ref under the same remotes that only one can own', async () => {
		const git = new FakeGit({ ...BEHIND, ...BOTH_REMOTES });
		await makeService(git).run(
			makeMessage({ remoteBranches: [{ remote: 'team', branch: 'main' }] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.callsTo('merge')).toEqual([['merge', '--ff-only', 'refs/remotes/team/main']]);
	});
});

describe('returning to the previous branch', () => {
	const EXPECTED = { previousBranch: 'dev-locpham', headHash: 'aaaa1111' };

	function detachedAt(hash: string, previous: string): Record<string, string> {
		return {
			'rev-parse HEAD': `${hash}\n`,
			// Empty: HEAD is detached, so there is no symbolic ref to print.
			'symbolic-ref': '',
			'rev-parse --abbrev-ref @{-1}': `${previous}\n`,
		};
	}

	it('checks out the branch the banner named', async () => {
		const git = new FakeGit(detachedAt('aaaa1111', 'dev-locpham'));
		const changed = await makeService(git).run(
			makeMessage({ action: 'checkoutPrevious', hash: 'aaaa1111', expected: EXPECTED }),
			'/repo',
			SILENT_PROMPT
		);
		expect(changed).toBe(true);
		expect(git.callsTo('checkout')).toEqual([['checkout', '--end-of-options', 'dev-locpham']]);
	});

	it('refuses when HEAD moved since the banner was drawn', async () => {
		// A terminal checked something else out while the banner sat there.
		const git = new FakeGit(detachedAt('bbbb2222', 'dev-locpham'));
		await makeService(git).run(
			makeMessage({ action: 'checkoutPrevious', hash: 'aaaa1111', expected: EXPECTED }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('checkout')).toBe(false);
		expect(recorded.listErrors.join(' ')).toContain('moved since');
	});

	it('refuses when the previous branch is no longer the one shown', async () => {
		const git = new FakeGit(detachedAt('aaaa1111', 'some-other-branch'));
		await makeService(git).run(
			makeMessage({ action: 'checkoutPrevious', hash: 'aaaa1111', expected: EXPECTED }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('checkout')).toBe(false);
	});

	it('refuses when HEAD is no longer detached at all', async () => {
		const git = new FakeGit({
			...detachedAt('aaaa1111', 'dev-locpham'),
			'symbolic-ref': 'main\n',
		});
		await makeService(git).run(
			makeMessage({ action: 'checkoutPrevious', hash: 'aaaa1111', expected: EXPECTED }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('checkout')).toBe(false);
	});

	it('refuses an action carrying no recorded state', async () => {
		const git = new FakeGit(detachedAt('aaaa1111', 'dev-locpham'));
		await makeService(git).run(
			makeMessage({ action: 'checkoutPrevious', hash: 'aaaa1111' }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('checkout')).toBe(false);
	});
});
