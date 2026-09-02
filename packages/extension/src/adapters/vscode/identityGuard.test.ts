import { beforeEach, describe, expect, it } from 'vitest';
import type { GitIdentity } from '@git-octopus/shared';
import {
	ConfigurationTarget,
	mapConfig,
	mapConfigTarget,
	recorded,
	resetRecorded,
} from '../../test/vscodeStub.js';
import { attachView, makeController, memento } from '../../test/controllerHarness.js';
import { FakeGit } from '../../test/fakeGit.js';

/**
 * `identityAction` is the one repo-scoped message that used to run against whatever repository the
 * controller happened to be on, and it writes `git config --local` — including an `--unset` that
 * removes an override the user set deliberately.
 *
 * It is also a mixed message: the saved-identity list riding along with it is a global setting, and
 * that half must survive whatever happens to the repo-scoped half.
 */

const STATE_ACTIVE_REPO = 'gitOctopus.activeRepo';
const ACTIVE_REPO = '/repo/active';
const OTHER_REPO = '/repo/somewhere-else';
const IDENTITIES = 'gitOctopus.identities';

const WORK: GitIdentity = { label: 'Work', name: 'Ada', email: 'ada@work.example' };

function activeController(git: FakeGit) {
	return makeController({
		executor: git,
		workspaceState: memento({ [STATE_ACTIVE_REPO]: ACTIVE_REPO }),
	});
}

beforeEach(resetRecorded);

describe('an identity action stamped with a repository that is no longer active', () => {
	it('never writes the local config, and says why nothing ran', async () => {
		const git = new FakeGit();
		const view = await attachView(activeController(git));

		await view.webview.receive({
			type: 'identityAction',
			repoPath: OTHER_REPO,
			action: 'apply',
			name: 'Ada',
			email: 'ada@work.example',
		});

		expect(git.ranArgv('config --local user.name Ada')).toBe(false);
		expect(git.ranArgv('config --local user.email ada@work.example')).toBe(false);
		expect(recorded.listWarnings.join(' ')).toContain('active repository changed');
	});

	it('never unsets an override the user set on purpose', async () => {
		// The destructive direction: `--unset` throws away a deliberate per-repo identity, and the
		// only feedback names the identity rather than the repository it was removed from.
		const git = new FakeGit();
		const view = await attachView(activeController(git));

		await view.webview.receive({
			type: 'identityAction',
			repoPath: OTHER_REPO,
			action: 'clearOverride',
		});

		expect(git.ranArgv('--unset')).toBe(false);
	});

	it('still saves the identity list the refused action was carrying', async () => {
		// Adding an account and switching to it is one message. The switch may be refused; the
		// account the user typed has already been shown as saved and must not vanish with it.
		const git = new FakeGit();
		const view = await attachView(activeController(git));

		await view.webview.receive({
			type: 'identityAction',
			repoPath: OTHER_REPO,
			action: 'apply',
			name: WORK.name,
			email: WORK.email,
			listIdentities: [WORK],
		});

		expect(mapConfig.get(IDENTITIES)).toEqual([WORK]);
		// The reply that follows still *reads* the local config; only the write must not happen.
		expect(git.ranArgv(`config --local user.name ${WORK.name}`)).toBe(false);
	});
});

describe('an identity action in a workspace with no repository', () => {
	it('saves the identity list rather than dropping the whole message', async () => {
		// The account dropdown is reachable with no repository open, and the view adds the account
		// to its own list before posting. Dropping the message here loses it with no error at all.
		const git = new FakeGit();
		const view = await attachView(makeController({ executor: git }));

		await view.webview.receive({
			type: 'identityAction',
			repoPath: '',
			action: 'apply',
			name: WORK.name,
			email: WORK.email,
			listIdentities: [WORK],
		});

		expect(mapConfig.get(IDENTITIES)).toEqual([WORK]);
	});

	it('runs no git and raises no warning, because no repository changed', async () => {
		const git = new FakeGit();
		const view = await attachView(makeController({ executor: git }));

		await view.webview.receive({
			type: 'identityAction',
			repoPath: '',
			action: 'apply',
			name: WORK.name,
			email: WORK.email,
		});

		expect(git.ranArgv(`config --local user.name ${WORK.name}`)).toBe(false);
		expect(recorded.listWarnings).toEqual([]);
		expect(recorded.listErrors).toEqual([]);
	});
});

describe('an identity action stamped with the active repository', () => {
	it('writes the local config and tells the user which identity now commits here', async () => {
		const git = new FakeGit();
		const view = await attachView(activeController(git));

		await view.webview.receive({
			type: 'identityAction',
			repoPath: ACTIVE_REPO,
			action: 'apply',
			name: WORK.name,
			email: WORK.email,
		});

		expect(git.ranArgv(`config --local user.name ${WORK.name}`)).toBe(true);
		expect(git.ranArgv(`config --local user.email ${WORK.email}`)).toBe(true);
		// The write targets the repository the host is on, never the one named in the message.
		expect(git.cwdsFor('config --local user.name')).toEqual([ACTIVE_REPO]);
		expect(recorded.listInfo.join(' ')).toContain(WORK.email);
	});

	it('unsets both fields when the user asks to go back to the global identity', async () => {
		const git = new FakeGit();
		const view = await attachView(activeController(git));

		await view.webview.receive({
			type: 'identityAction',
			repoPath: ACTIVE_REPO,
			action: 'clearOverride',
		});

		expect(git.ranArgv('--unset')).toBe(true);
	});
});

describe('saving identities', () => {
	it('is not repo-scoped: it persists with no repository active and warns about nothing', async () => {
		// A regression guard against re-filing the old note, which lumped this message in with
		// `identityAction`. Adding a stamp here would only add a way to lose the user's accounts.
		const git = new FakeGit();
		const view = await attachView(makeController({ executor: git }));

		await view.webview.receive({ type: 'saveIdentities', listIdentities: [WORK] });

		expect(mapConfig.get(IDENTITIES)).toEqual([WORK]);
		// Global, never per-workspace: an account saved into one folder's settings is invisible
		// everywhere else, which reads to the user as the account having been lost.
		expect(mapConfigTarget.get(IDENTITIES)).toBe(ConfigurationTarget.Global);
		expect(recorded.listWarnings).toEqual([]);
		expect(git.listCalls).toEqual([]);
	});
});
