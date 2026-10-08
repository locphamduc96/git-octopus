import { beforeEach, describe, expect, it } from 'vitest';
import type { CommitActionMessage } from '@git-octopus/shared';
import type { UserPrompt } from '../../app/ports/userPrompt.js';
import { CommitActionService, type HostViewSettings } from './CommitActionService.js';
import { recorded, resetRecorded } from '../../test/vscodeStub.js';
import { FakeGit } from '../../test/fakeGit.js';

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

/** The same branch, reached by its local name, with an upstream configured. */
const BEHIND_LOCAL: Record<string, string> = {
	...BEHIND,
	'for-each-ref --format=%(upstream)': 'refs/remotes/origin/wikz\0origin/wikz\n',
};

describe('checkout of a local branch', () => {
	it('fast-forwards a local branch that has fallen behind its upstream', async () => {
		// The defect this covers: double-click and `Checkout <name>` ran a bare `git checkout`, so a
		// branch left behind yesterday was checked out still behind and nothing said so.
		const git = new FakeGit(BEHIND_LOCAL);
		await makeService(git, { autoFastForwardOnCheckout: true }).run(
			makeMessage({ branches: ['wikz'] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.callsTo('merge')).toEqual([['merge', '--ff-only', 'refs/remotes/origin/wikz']]);
	});

	it('measures against the upstream git names, not against a remote of the same name', async () => {
		const git = new FakeGit({
			...BEHIND,
			'for-each-ref --format=%(upstream)': 'refs/remotes/upstream/wikz\0upstream/wikz\n',
		});
		await makeService(git, { autoFastForwardOnCheckout: true }).run(
			makeMessage({ branches: ['wikz'], remoteBranches: [{ remote: 'origin', branch: 'wikz' }] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.callsTo('merge')).toEqual([['merge', '--ff-only', 'refs/remotes/upstream/wikz']]);
	});

	it('honours the setting on the local path too', async () => {
		const git = new FakeGit(BEHIND_LOCAL);
		await makeService(git, { autoFastForwardOnCheckout: false }).run(
			makeMessage({ branches: ['wikz'] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('merge')).toBe(false);
		expect(git.callsTo('checkout')).toEqual([['checkout', 'wikz']]);
	});

	it('leaves a dirty tree alone on the local path too', async () => {
		const git = new FakeGit({ ...BEHIND_LOCAL, 'status --porcelain': ' M src/a.ts\n' });
		await makeService(git, { autoFastForwardOnCheckout: true }).run(
			makeMessage({ branches: ['wikz'] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('merge')).toBe(false);
	});

	it('just checks out a branch with no upstream at all', async () => {
		const git = new FakeGit({ ...BEHIND, 'for-each-ref --format=%(upstream)': '\0\n' });
		await makeService(git, { autoFastForwardOnCheckout: true }).run(
			makeMessage({ branches: ['solo'] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('merge')).toBe(false);
		expect(git.callsTo('checkout')).toEqual([['checkout', 'solo']]);
	});

	it('falls back to a remote of the same name when no upstream is configured', async () => {
		const git = new FakeGit({ ...BEHIND, 'for-each-ref --format=%(upstream)': '\0\n' });
		await makeService(git, { autoFastForwardOnCheckout: true }).run(
			makeMessage({ branches: ['wikz'], remoteBranches: [{ remote: 'origin', branch: 'wikz' }] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.callsTo('merge')).toEqual([['merge', '--ff-only', 'refs/remotes/origin/wikz']]);
	});

	it('ignores a fallback remote that is about a different branch', async () => {
		const git = new FakeGit({ ...BEHIND, 'for-each-ref --format=%(upstream)': '\0\n' });
		await makeService(git, { autoFastForwardOnCheckout: true }).run(
			makeMessage({ branches: ['wikz'], remoteBranches: [{ remote: 'origin', branch: 'other' }] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('merge')).toBe(false);
		expect(git.callsTo('checkout')).toEqual([['checkout', 'wikz']]);
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

/** A local branch with commits of its own, three behind its remote, on a clean tree. */
const DIVERGED: Record<string, string> = {
	'rev-parse --verify --quiet refs/heads/': 'abc123\n',
	'rev-list --count --left-right': '2\t3\n',
	'status --porcelain': '',
};

const DIVERGED_LOCAL: Record<string, string> = {
	...DIVERGED,
	'for-each-ref --format=%(upstream)': 'refs/remotes/origin/wikz\0origin/wikz\n',
};

/** A prompt that answers every pick with `choice` and remembers what it was shown. */
function choosing(
	choice: string | null
): UserPrompt & { listTitles: string[]; listIds: string[][] } {
	const prompt = {
		listTitles: [] as string[],
		listIds: [] as string[][],
		confirm: () => Promise.resolve(true),
		inputText: () => Promise.resolve(undefined),
		pickOptions: (request: Parameters<UserPrompt['pickOptions']>[0]) => {
			prompt.listTitles.push(request.title);
			prompt.listIds.push(request.listOptions.map((option) => option.id));
			return Promise.resolve(choice === null ? undefined : [choice]);
		},
	};
	return prompt;
}

const REMOTE_WIKZ = { remoteBranches: [{ remote: 'origin', branch: 'wikz' }] };

describe('checkout of a diverged branch', () => {
	it('checks out first, then asks how to meet the remote when pointed at the remote ref', async () => {
		// Fast-forward is impossible here, and the old answer was a sentence and nothing else. The
		// checkout still happens before any question: dismissing must leave the user on the branch.
		const git = new FakeGit(DIVERGED);
		const prompt = choosing(null);
		await makeService(git, { autoFastForwardOnCheckout: true }).run(
			makeMessage(REMOTE_WIKZ),
			'/repo',
			prompt
		);
		expect(git.callsTo('checkout')).toEqual([['checkout', 'wikz']]);
		expect(prompt.listTitles).toEqual([
			'wikz has diverged from origin/wikz — 2 commits ahead, 3 commits behind',
		]);
		expect(prompt.listIds).toEqual([['merge', 'rebase', 'reset']]);
		expect(git.ran('merge')).toBe(false);
		expect(git.ran('rebase')).toBe(false);
		expect(git.ran('reset')).toBe(false);
	});

	it('merges the remote ref in by its full path when asked to', async () => {
		const git = new FakeGit(DIVERGED);
		await makeService(git).run(makeMessage(REMOTE_WIKZ), '/repo', choosing('merge'));
		expect(git.callsTo('merge')).toEqual([['merge', '--no-edit', 'refs/remotes/origin/wikz']]);
	});

	it('rebases onto the remote ref when asked to', async () => {
		const git = new FakeGit(DIVERGED);
		await makeService(git).run(makeMessage(REMOTE_WIKZ), '/repo', choosing('rebase'));
		expect(git.callsTo('rebase')).toEqual([['rebase', 'refs/remotes/origin/wikz']]);
	});

	it('hard-resets to the remote ref when asked to, after the checkout', async () => {
		const git = new FakeGit(DIVERGED);
		await makeService(git).run(makeMessage(REMOTE_WIKZ), '/repo', choosing('reset'));
		expect(git.listCalls.filter((args) => args[0] === 'checkout' || args[0] === 'reset')).toEqual([
			['checkout', 'wikz'],
			['reset', '--hard', 'refs/remotes/origin/wikz'],
		]);
	});

	it('withholds reset while the tree is dirty', async () => {
		// `reset --hard` would take the uncommitted work along with the commits it names.
		const git = new FakeGit({ ...DIVERGED, 'status --porcelain': ' M a.txt\n' });
		const prompt = choosing(null);
		await makeService(git).run(makeMessage(REMOTE_WIKZ), '/repo', prompt);
		expect(prompt.listIds).toEqual([['merge', 'rebase']]);
	});

	it('does not ask when the user pointed at the local branch', async () => {
		// Someone keeping unpushed work on a branch checks it out to work on it, not to be asked
		// how to discard it each time. The gap is still said.
		const git = new FakeGit(DIVERGED_LOCAL);
		const prompt = choosing('reset');
		await makeService(git).run(makeMessage({ branches: ['wikz'] }), '/repo', prompt);
		expect(prompt.listTitles).toEqual([]);
		expect(git.callsTo('checkout')).toEqual([['checkout', 'wikz']]);
		expect(git.ran('reset')).toBe(false);
		expect(recorded.listInfo.at(-1)).toContain('3 commits behind and 2 ahead — branches diverged');
	});

	it('asks through the explicit checkoutRemote action as well', async () => {
		const git = new FakeGit(DIVERGED);
		const prompt = choosing(null);
		await makeService(git).run(
			makeMessage({ action: 'checkoutRemote', ...REMOTE_WIKZ }),
			'/repo',
			prompt
		);
		expect(prompt.listIds).toEqual([['merge', 'rebase', 'reset']]);
	});
});

/** A local branch one commit ahead of its remote and nothing behind, on a clean tree. */
const AHEAD: Record<string, string> = {
	'rev-parse --verify --quiet refs/heads/': 'abc123\n',
	'rev-list --count --left-right': '1\t0\n',
	'status --porcelain': '',
};

const AHEAD_LOCAL: Record<string, string> = {
	...AHEAD,
	'for-each-ref --format=%(upstream)': 'refs/remotes/origin/wikz\0origin/wikz\n',
};

describe('checkout of a branch that is only ahead', () => {
	it('checks out first, then offers reset or push when pointed at the remote ref', async () => {
		// Checking out cannot put the branch on the remote's commit: it is ahead, not behind. The
		// old answer was a plain "Checked out", which read as the gesture doing nothing.
		const git = new FakeGit(AHEAD);
		const prompt = choosing(null);
		await makeService(git).run(makeMessage(REMOTE_WIKZ), '/repo', prompt);
		expect(git.callsTo('checkout')).toEqual([['checkout', 'wikz']]);
		expect(prompt.listTitles).toEqual(['wikz is 1 commit ahead of origin/wikz']);
		expect(prompt.listIds).toEqual([['reset', 'push']]);
		expect(git.ran('reset')).toBe(false);
		expect(git.ran('push')).toBe(false);
	});

	it('hard-resets to the remote ref when asked to', async () => {
		const git = new FakeGit(AHEAD);
		await makeService(git).run(makeMessage(REMOTE_WIKZ), '/repo', choosing('reset'));
		expect(git.callsTo('reset')).toEqual([['reset', '--hard', 'refs/remotes/origin/wikz']]);
	});

	it('pushes the branch to the remote it was reached from by full refspec', async () => {
		const git = new FakeGit(AHEAD_LOCAL);
		await makeService(git).run(makeMessage(REMOTE_WIKZ), '/repo', choosing('push'));
		expect(git.callsTo('push')).toEqual([
			['push', '--end-of-options', 'origin', 'refs/heads/wikz:refs/heads/wikz'],
		]);
		expect(git.ran('reset')).toBe(false);
	});

	it('sets the upstream while pushing a branch that has none', async () => {
		const git = new FakeGit(AHEAD);
		await makeService(git).run(makeMessage(REMOTE_WIKZ), '/repo', choosing('push'));
		expect(git.callsTo('push')[0]).toContain('--set-upstream');
	});

	it('says where the commits a reset would drop still live', async () => {
		const withMaster = {
			...AHEAD,
			'for-each-ref --format=%(refname) --contains':
				'refs/heads/master\nrefs/heads/wikz\nrefs/remotes/origin/master\n',
		};
		const kept = choosing(null);
		const listDescriptions: string[] = [];
		kept.pickOptions = (request) => {
			listDescriptions.push(...request.listOptions.map((option) => option.description ?? ''));
			return Promise.resolve(undefined);
		};
		await makeService(new FakeGit(withMaster)).run(makeMessage(REMOTE_WIKZ), '/repo', kept);
		expect(listDescriptions[0]).toBe('drops 1 commit from wikz — still on master');

		listDescriptions.length = 0;
		const alone = { ...AHEAD, 'for-each-ref --format=%(refname) --contains': 'refs/heads/wikz\n' };
		await makeService(new FakeGit(alone)).run(makeMessage(REMOTE_WIKZ), '/repo', kept);
		expect(listDescriptions[0]).toBe('drops 1 commit from wikz — only on this branch; undoable');
	});

	it('withholds reset while the tree is dirty', async () => {
		const git = new FakeGit({ ...AHEAD, 'status --porcelain': ' M a.txt\n' });
		const prompt = choosing(null);
		await makeService(git).run(makeMessage(REMOTE_WIKZ), '/repo', prompt);
		expect(prompt.listIds).toEqual([['push']]);
	});

	it('does not ask when the user pointed at the local branch, but says it is ahead', async () => {
		const git = new FakeGit(AHEAD_LOCAL);
		const prompt = choosing('reset');
		await makeService(git).run(makeMessage({ branches: ['wikz'] }), '/repo', prompt);
		expect(prompt.listTitles).toEqual([]);
		expect(git.ran('reset')).toBe(false);
		expect(recorded.listInfo.at(-1)).toContain('Checked out wikz — 1 commit ahead of origin/wikz');
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

describe('rename branch', () => {
	const prompting = (name: string | undefined): UserPrompt => ({
		...SILENT_PROMPT,
		inputText: () => Promise.resolve(name),
	});

	it('renames through `branch -m`, old name first', async () => {
		const git = new FakeGit();
		const done = await makeService(git).run(
			makeMessage({ action: 'renameBranch', branches: ['feature'] }),
			'/repo',
			prompting('feature-renamed')
		);
		expect(done).toBe(true);
		expect(git.callsTo('branch')).toEqual([['branch', '-m', 'feature', 'feature-renamed']]);
	});

	it('does nothing when the name is unchanged or dismissed', async () => {
		for (const answer of ['feature', '   ', undefined]) {
			const git = new FakeGit();
			await makeService(git).run(
				makeMessage({ action: 'renameBranch', branches: ['feature'] }),
				'/repo',
				prompting(answer)
			);
			expect(git.ran('branch')).toBe(false);
		}
	});
});

describe('add tag', () => {
	const choosing = (kind: string, text?: string): UserPrompt => ({
		confirm: () => Promise.resolve(true),
		// First ask is the tag name, second (annotated only) is the message.
		inputText: (request) => Promise.resolve(request.multiline ? text : 'v1'),
		pickOptions: () => Promise.resolve([kind]),
	});

	it('creates a lightweight tag exactly as before', async () => {
		const git = new FakeGit();
		await makeService(git).run(
			makeMessage({ action: 'addTag', hash: 'abc123' }),
			'/repo',
			choosing('lightweight')
		);
		expect(git.callsTo('tag')).toEqual([['tag', 'v1', 'abc123']]);
	});

	it('creates an annotated tag with the entered message', async () => {
		const git = new FakeGit();
		await makeService(git).run(
			makeMessage({ action: 'addTag', hash: 'abc123' }),
			'/repo',
			choosing('annotated', 'Release v1')
		);
		expect(git.callsTo('tag')).toEqual([['tag', '-a', 'v1', '-m', 'Release v1', 'abc123']]);
	});

	it('creates nothing when the annotated message is dismissed', async () => {
		const git = new FakeGit();
		await makeService(git).run(
			makeMessage({ action: 'addTag', hash: 'abc123' }),
			'/repo',
			choosing('annotated', undefined)
		);
		expect(git.ran('tag')).toBe(false);
	});
});

describe('delete branch, force offered only on the unmerged refusal', () => {
	/** A git that refuses `branch -d` the way the real one refuses an unmerged branch. */
	class RefusingGit extends FakeGit {
		public constructor(private readonly refusal: string) {
			super();
		}

		public override run(args: string[]): Promise<string> {
			if (args[0] === 'branch' && args[1] === '-d') {
				this.listCalls.push(args);
				return Promise.reject(new Error(this.refusal));
			}
			return super.run(args);
		}
	}

	const UNMERGED = "error: the branch 'feature' is not fully merged";

	it('deletes with `-d` alone when git accepts it', async () => {
		const git = new FakeGit();
		const done = await makeService(git).run(
			makeMessage({ action: 'deleteBranch', branches: ['feature'] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(done).toBe(true);
		expect(git.callsTo('branch')).toEqual([['branch', '-d', 'feature']]);
	});

	it('offers force on the unmerged refusal and runs `-D` once confirmed', async () => {
		const git = new RefusingGit(UNMERGED);
		const listConfirms: string[] = [];
		const done = await makeService(git).run(
			makeMessage({ action: 'deleteBranch', branches: ['feature'] }),
			'/repo',
			{
				...SILENT_PROMPT,
				confirm: (request) => {
					listConfirms.push(`${request.confirmLabel}|${request.danger}`);
					return Promise.resolve(true);
				},
			}
		);
		expect(done).toBe(true);
		expect(git.callsTo('branch')).toEqual([
			['branch', '-d', 'feature'],
			['branch', '-D', 'feature'],
		]);
		// The offer must be the danger-styled one, not another default Yes.
		expect(listConfirms).toEqual(['Force delete|true']);
	});

	it('stops at the refusal when the force offer is declined', async () => {
		const git = new RefusingGit(UNMERGED);
		const done = await makeService(git).run(
			makeMessage({ action: 'deleteBranch', branches: ['feature'] }),
			'/repo',
			{ ...SILENT_PROMPT, confirm: () => Promise.resolve(false) }
		);
		expect(done).toBe(false);
		expect(git.callsTo('branch')).toEqual([['branch', '-d', 'feature']]);
	});

	it('never offers force for any other failure', async () => {
		const git = new RefusingGit('fatal: some unrelated failure');
		const done = await makeService(git).run(
			makeMessage({ action: 'deleteBranch', branches: ['feature'] }),
			'/repo',
			SILENT_PROMPT
		);
		expect(done).toBe(false);
		expect(git.callsTo('branch')).toEqual([['branch', '-d', 'feature']]);
		expect(recorded.listErrors.join(' ')).toContain('unrelated failure');
	});
});

describe('pushing a branch that is not checked out', () => {
	/** The branch exists locally and already tracks a remote. */
	const PUSHABLE: Record<string, string> = {
		'rev-parse --verify --quiet refs/heads/': 'abc123\n',
		'for-each-ref --format=%(upstream)': 'refs/remotes/origin/wikz\0origin/wikz\n',
		remote: 'origin\n',
	};

	it('pushes a fully-qualified refspec, never through HEAD', async () => {
		const git = new FakeGit(PUSHABLE);
		await makeService(git).run(
			makeMessage({
				action: 'pushBranch',
				remoteBranches: [{ remote: 'origin', branch: 'wikz' }],
			}),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.callsTo('push')).toEqual([
			['push', '--end-of-options', 'origin', 'refs/heads/wikz:refs/heads/wikz'],
		]);
	});

	it('sets the upstream when the branch has none yet', async () => {
		const git = new FakeGit({ ...PUSHABLE, 'for-each-ref --format=%(upstream)': '\0\n' });
		await makeService(git).run(
			makeMessage({
				action: 'pushBranch',
				remoteBranches: [{ remote: 'origin', branch: 'wikz' }],
			}),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.callsTo('push')).toEqual([
			['push', '--set-upstream', '--end-of-options', 'origin', 'refs/heads/wikz:refs/heads/wikz'],
		]);
	});

	it('refuses when there is no local branch of that name', async () => {
		const git = new FakeGit({ ...PUSHABLE, 'rev-parse --verify --quiet refs/heads/': '' });
		await makeService(git).run(
			makeMessage({
				action: 'pushBranch',
				remoteBranches: [{ remote: 'origin', branch: 'wikz' }],
			}),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('push')).toBe(false);
	});

	// `refs/remotes/origin/team/wikz` could belong to a remote called `origin` or one called
	// `origin/team`; there is no telling which, so nothing is pushed.
	it('refuses when the ref path could belong to either of two remotes', async () => {
		const git = new FakeGit({ ...PUSHABLE, remote: 'origin\norigin/team\n' });
		await makeService(git).run(
			makeMessage({
				action: 'pushBranch',
				remoteBranches: [{ remote: 'origin', branch: 'team/wikz' }],
			}),
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('push')).toBe(false);
	});
});

describe('rebasing a range of commits onto another branch', () => {
	const NEW = 'n'.repeat(40);
	const OLD = 'o'.repeat(40);

	/** A clean repo on `main`, with the selection being the two commits at its tip. */
	const AT_TIP: Record<string, string> = {
		'symbolic-ref --short HEAD': 'main\n',
		'rev-list --merges': '',
		'status --porcelain': '',
		'rev-parse HEAD': `${NEW}\n`,
		'rev-list --first-parent --parents': `${NEW} ${OLD}\n${OLD} p\n`,
		'for-each-ref --format=%(refname:short)': 'main\ndev\n',
	};

	it('replays the range onto the branch that was picked', async () => {
		const git = new FakeGit(AT_TIP);
		await makeService(git).runMulti(
			{
				type: 'multiCommitAction',
				repoPath: '/repo',
				action: 'rebaseRange',
				hashes: [NEW, OLD],
				subjects: ['a', 'b'],
			},
			'/repo',
			SILENT_PROMPT
		);
		expect(git.callsTo('rebase')).toEqual([['rebase', '--onto', 'dev', `${OLD}^`, 'main']]);
	});

	// The command replays to the tip whatever was selected, so a selection stopping short would
	// move more commits than the user picked.
	it('refuses when the newest selected commit is not the branch tip', async () => {
		const git = new FakeGit({ ...AT_TIP, 'rev-parse HEAD': `${'z'.repeat(40)}\n` });
		await makeService(git).runMulti(
			{
				type: 'multiCommitAction',
				repoPath: '/repo',
				action: 'rebaseRange',
				hashes: [NEW, OLD],
				subjects: ['a', 'b'],
			},
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('rebase')).toBe(false);
	});

	it('never offers the branch it would rebase as its own target', async () => {
		const git = new FakeGit({ ...AT_TIP, 'for-each-ref --format=%(refname:short)': 'main\n' });
		await makeService(git).runMulti(
			{
				type: 'multiCommitAction',
				repoPath: '/repo',
				action: 'rebaseRange',
				hashes: [NEW, OLD],
				subjects: ['a', 'b'],
			},
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('rebase')).toBe(false);
	});

	it('refuses when the selection no longer matches the repository', async () => {
		const git = new FakeGit({ ...AT_TIP, 'rev-list --first-parent --parents': `${NEW} a b\n` });
		await makeService(git).runMulti(
			{
				type: 'multiCommitAction',
				repoPath: '/repo',
				action: 'rebaseRange',
				hashes: [NEW, OLD],
				subjects: ['a', 'b'],
			},
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('rebase')).toBe(false);
	});

	it('refuses over a dirty tree', async () => {
		const git = new FakeGit({ ...AT_TIP, 'status --porcelain': ' M a.ts\n' });
		await makeService(git).runMulti(
			{
				type: 'multiCommitAction',
				repoPath: '/repo',
				action: 'rebaseRange',
				hashes: [NEW, OLD],
				subjects: ['a', 'b'],
			},
			'/repo',
			SILENT_PROMPT
		);
		expect(git.ran('rebase')).toBe(false);
	});
});
