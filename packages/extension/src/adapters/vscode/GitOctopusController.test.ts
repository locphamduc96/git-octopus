import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommitActionMessage } from '@git-octopus/shared';
import { STATE_VIEW_SETTINGS } from './GitOctopusController.js';
import { Uri, recorded, resetRecorded, workspace } from '../../test/vscodeStub.js';
import { attachView, makeController, memento } from '../../test/controllerHarness.js';

/**
 * The controller decides which view hears what, and when an action is allowed to touch git at all.
 * Neither is visible to a use-case test: both are about the wiring between several attached
 * webviews and one repository, which only exists here.
 */

const STATE_ACTIVE_REPO = 'gitOctopus.activeRepo';
const ACTIVE_REPO = '/repo/active';

/** A commit action carrying the repository stamp the protocol requires. */
function stampedAction(repoPath: string): CommitActionMessage {
	return {
		type: 'commitAction',
		repoPath,
		action: 'checkoutBranch',
		hash: 'abc1234',
		subject: 'Something',
		branches: ['feature'],
		remoteBranches: [],
	};
}

/** Let every already-resolved promise in the chain run before asserting nothing happened. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(resetRecorded);

describe('an action stamped with a repository that is no longer active', () => {
	it('never reaches the service, and says why nothing ran', async () => {
		const listRuns: string[] = [];
		const controller = makeController({
			workspaceState: memento({ [STATE_ACTIVE_REPO]: ACTIVE_REPO }),
			actions: {
				run: (message) => {
					listRuns.push(message.repoPath);
					return Promise.resolve(false);
				},
			},
		});
		const view = await attachView(controller);

		await view.webview.receive(stampedAction('/repo/somewhere-else'));

		expect(listRuns).toEqual([]);
		// The stub files warnings with the information messages — both are notifications.
		expect(recorded.listWarnings.join(' ')).toContain('active repository changed');
	});

	it('is dropped without a warning when there is no active repository at all', async () => {
		// Every guarded case reads `if (!cwd || this.repoMismatch(message)) return;`, so with nothing
		// active the handler returns before the guard — there is no repository to have changed, and
		// a warning here would fire on every click in a workspace that holds no repository.
		const listRuns: string[] = [];
		const controller = makeController({
			actions: {
				run: (message) => {
					listRuns.push(message.repoPath);
					return Promise.resolve(false);
				},
			},
		});
		const view = await attachView(controller);

		await view.webview.receive(stampedAction(ACTIVE_REPO));

		expect(listRuns).toEqual([]);
		expect(recorded.listWarnings).toEqual([]);
		expect(recorded.listInfo).toEqual([]);
		expect(recorded.listErrors).toEqual([]);
	});
});

describe('opening a view', () => {
	it('sends the icons, the colour theme and the saved settings before the reply the view waits on', async () => {
		// `loadCommits` is also the webview saying it is listening: anything posted earlier would be
		// dropped, so these three have to ride along with it and land before the answer it waits on.
		const controller = makeController({
			globalState: memento({ [STATE_VIEW_SETTINGS]: { fileView: 'tree' } }),
		});
		const view = await attachView(controller);

		await view.webview.receive({ type: 'loadCommits', limit: 300 });

		// The relation, not the exact set: another message added at open time is not a regression,
		// one of these arriving after the reply is. No workspace folder here, so the reply the view
		// waits on is the "nothing to show" error rather than commits.
		const listTypes = view.webview.listTypes;
		for (const type of ['fileIcons', 'colorTheme', 'viewSettings']) {
			expect(listTypes.indexOf(type), type).toBeGreaterThanOrEqual(0);
			expect(listTypes.indexOf(type), type).toBeLessThan(listTypes.indexOf('error'));
		}
		expect(view.webview.postedOfType('viewSettings')).toEqual([
			{ type: 'viewSettings', settings: { fileView: 'tree' } },
		]);
	});
});

describe('a question sent to one view', () => {
	it('is not answered by a uiReply that arrives on another view', async () => {
		const listConfirmed: boolean[] = [];
		const controller = makeController({
			workspaceState: memento({ [STATE_ACTIVE_REPO]: ACTIVE_REPO }),
			actions: {
				run: async (_message, _cwd, prompt) => {
					listConfirmed.push(await prompt.confirm({ title: 'Checkout', message: 'Sure?' }));
					return false;
				},
			},
		});
		const asking = await attachView(controller);
		const other = await attachView(controller);

		let settled = false;
		const running = asking.webview.receive(stampedAction(ACTIVE_REPO)).then(() => {
			settled = true;
		});

		// The action no longer starts synchronously: the undo log snapshots the repository first, so
		// the question is posted a turn later.
		await flush();
		const [request] = asking.webview.postedOfType('uiRequest');
		expect(request).toBeDefined();
		expect(other.webview.postedOfType('uiRequest')).toEqual([]);

		// The id is real and still open — only the view it arrives on is wrong.
		await other.webview.receive({ type: 'uiReply', requestId: request.requestId, confirmed: true });
		await flush();
		expect(settled).toBe(false);
		expect(listConfirmed).toEqual([]);

		await asking.webview.receive({
			type: 'uiReply',
			requestId: request.requestId,
			confirmed: true,
		});
		await running;
		expect(listConfirmed).toEqual([true]);
	});
});

describe('the limit a shared answer is loaded at', () => {
	let repoDir = '';

	beforeEach(async () => {
		// `discoverRepos` reads the real filesystem, and a directory holding `.git` is all it needs.
		repoDir = await mkdtemp(path.join(tmpdir(), 'git-octopus-controller-'));
		await mkdir(path.join(repoDir, '.git'));
		workspace.workspaceFolders = [{ uri: Uri.file(repoDir), name: 'repo', index: 0 }];
	});

	afterEach(() => rm(repoDir, { recursive: true, force: true }));

	it('covers the deepest history any attached view is standing in', async () => {
		const controller = makeController();
		const deep = await attachView(controller);
		const shallow = await attachView(controller);

		await deep.webview.receive({ type: 'loadCommits', limit: 900 });
		await shallow.webview.receive({ type: 'loadCommits', limit: 50 });

		// The second answer is the one that matters: a fresh tab asking for 50 must not cut the
		// panel scrolled 900 commits in back to its own page size.
		const listLimits = shallow.webview.postedOfType('commits').map((message) => message.limit);
		expect(listLimits).toEqual([900, 900]);
		expect(deep.webview.postedOfType('commits').map((message) => message.limit)).toEqual([
			900, 900,
		]);
	});

	it('drops back to what is left once the deepest view closes', async () => {
		const controller = makeController();
		const deep = await attachView(controller);
		const shallow = await attachView(controller);
		await deep.webview.receive({ type: 'loadCommits', limit: 900 });
		await shallow.webview.receive({ type: 'loadCommits', limit: 50 });

		// The per-view limit is cleaned up with the view. Left behind, it would hold every later
		// answer at 900 for a window nobody is looking at.
		deep.dispose();
		await shallow.webview.receive({ type: 'loadCommits', limit: 50 });

		expect(shallow.webview.postedOfType('commits').at(-1)?.limit).toBe(50);
	});
});

describe('saving the view settings', () => {
	it('reaches every view except the one that sent them', async () => {
		const globalState = memento();
		const controller = makeController({ globalState });
		const saving = await attachView(controller);
		const listening = await attachView(controller);
		const third = await attachView(controller);
		const settings = { fileView: 'tree', metaOpen: false };

		await saving.webview.receive({ type: 'saveViewSettings', settings });

		// The sender already applied them locally; echoing them back would fight its own state.
		expect(saving.webview.postedOfType('viewSettings')).toEqual([]);
		for (const view of [listening, third]) {
			expect(view.webview.postedOfType('viewSettings')).toEqual([
				{ type: 'viewSettings', settings },
			]);
		}
		expect(globalState.mapStored.get(STATE_VIEW_SETTINGS)).toEqual(settings);
	});
});

describe('a view whose container has closed', () => {
	it('stops receiving broadcasts once its disposer has run', async () => {
		const controller = makeController();
		const closing = await attachView(controller);
		const staying = await attachView(controller);

		closing.dispose();
		await controller.revealCommit('abc1234');

		expect(closing.webview.postedOfType('revealCommit')).toEqual([]);
		expect(staying.webview.postedOfType('revealCommit')).toEqual([
			{ type: 'revealCommit', hash: 'abc1234' },
		]);
		expect(recorded.listCommands.map((entry) => entry.command)).toEqual(['git-octopus.focus']);
	});
});

describe('AI commit asked to stage the tree first', () => {
	/** Both halves of the flow, in the order the host actually ran them. */
	function makeRecordingController(listOrder: string[]) {
		return makeController({
			workspaceState: memento({ [STATE_ACTIVE_REPO]: ACTIVE_REPO }),
			workingTree: {
				run: (message) => {
					listOrder.push(`workingTree:${message.action}`);
					return Promise.resolve(true);
				},
			},
			commitAgent: {
				generate: (message) => {
					listOrder.push('generate');
					return Promise.resolve({
						type: 'commitPlanResult',
						repoPath: message.repoPath,
						generationId: 0,
						error: 'no agent',
					});
				},
			},
		});
	}

	it('stages before it reads the tree, not alongside it', async () => {
		// Sent as two independent messages these raced: `git add -A` takes .git/index.lock while
		// generation's `git status` refreshes the index, so either the add lost the lock or the
		// status ran first and reported nothing staged.
		const listOrder: string[] = [];
		const view = await attachView(makeRecordingController(listOrder));

		await view.webview.receive({
			type: 'generateCommitPlan',
			repoPath: ACTIVE_REPO,
			stageAll: true,
		});

		expect(listOrder).toEqual(['workingTree:stageAll', 'generate']);
	});

	it('does not generate at all when the staging failed', async () => {
		const listOrder: string[] = [];
		const controller = makeController({
			workspaceState: memento({ [STATE_ACTIVE_REPO]: ACTIVE_REPO }),
			workingTree: { run: () => Promise.resolve(false) },
			commitAgent: {
				generate: (message) => {
					listOrder.push('generate');
					return Promise.resolve({
						type: 'commitPlanResult',
						repoPath: message.repoPath,
						generationId: 0,
						error: 'no agent',
					});
				},
			},
		});
		const view = await attachView(controller);

		await view.webview.receive({
			type: 'generateCommitPlan',
			repoPath: ACTIVE_REPO,
			stageAll: true,
		});

		expect(listOrder).toEqual([]);
	});

	it('leaves the tree alone when it was not asked to stage', async () => {
		const listOrder: string[] = [];
		const view = await attachView(makeRecordingController(listOrder));

		await view.webview.receive({ type: 'generateCommitPlan', repoPath: ACTIVE_REPO });

		expect(listOrder).toEqual(['generate']);
	});
});

describe('committing with push after', () => {
	function makePushRecorder(listOrder: string[], committed: boolean) {
		return makeController({
			workspaceState: memento({ [STATE_ACTIVE_REPO]: ACTIVE_REPO }),
			workingTree: {
				run: (message) => {
					listOrder.push(`workingTree:${message.action}`);
					return Promise.resolve(committed);
				},
			},
			repoActions: {
				run: (message) => {
					listOrder.push(`repoAction:${message.action}`);
					return Promise.resolve(true);
				},
				runSequencer: () => Promise.resolve(false),
			},
		});
	}

	it('pushes once the commit has landed', async () => {
		const listOrder: string[] = [];
		const view = await attachView(makePushRecorder(listOrder, true));
		await view.webview.receive({
			type: 'workingTreeAction',
			repoPath: ACTIVE_REPO,
			action: 'commit',
			message: 'feat: x',
			pushAfter: true,
		});
		expect(listOrder).toEqual(['workingTree:commit', 'repoAction:push']);
	});

	it('pushes nothing when the commit failed', async () => {
		const listOrder: string[] = [];
		const view = await attachView(makePushRecorder(listOrder, false));
		await view.webview.receive({
			type: 'workingTreeAction',
			repoPath: ACTIVE_REPO,
			action: 'commit',
			message: 'feat: x',
			pushAfter: true,
		});
		expect(listOrder).toEqual(['workingTree:commit']);
	});

	it('tells the view whether the commit went through, so a refused one keeps its message', async () => {
		for (const committed of [true, false]) {
			const view = await attachView(makePushRecorder([], committed));
			await view.webview.receive({
				type: 'workingTreeAction',
				repoPath: ACTIVE_REPO,
				action: 'commit',
				message: 'feat: x',
			});
			expect(view.webview.postedOfType('commitOutcome')).toEqual([
				{ type: 'commitOutcome', ok: committed },
			]);
		}
	});

	it('says nothing about other working-tree actions', async () => {
		const view = await attachView(makePushRecorder([], true));
		await view.webview.receive({
			type: 'workingTreeAction',
			repoPath: ACTIVE_REPO,
			action: 'stageAll',
		});
		expect(view.webview.postedOfType('commitOutcome')).toEqual([]);
	});
});

describe('graph keybindings', () => {
	beforeEach(() => resetRecorded());

	const contextWrites = () =>
		recorded.listCommands
			.filter((entry) => entry.command === 'setContext')
			.map((entry) => entry.listArgs);

	it('scopes the graph keybindings to a focused view through a context key', async () => {
		const controller = makeController();
		const view = await attachView(controller);
		await view.webview.receive({ type: 'viewFocus', focused: true });
		await view.webview.receive({ type: 'viewFocus', focused: false });
		expect(contextWrites()).toEqual([
			['gitOctopus.graphFocused', true],
			['gitOctopus.graphFocused', false],
		]);
	});

	it('hands a keybinding to the focused view only, and drops the focus when a view closes', async () => {
		const controller = makeController();
		const focused = await attachView(controller);
		const other = await attachView(controller);
		await focused.webview.receive({ type: 'viewFocus', focused: true });
		controller.sendHostCommand('createBranch');
		expect(focused.webview.postedOfType('hostCommand')).toEqual([
			{ type: 'hostCommand', command: 'createBranch' },
		]);
		expect(other.webview.postedOfType('hostCommand')).toEqual([]);
		focused.dispose();
		expect(contextWrites().at(-1)).toEqual(['gitOctopus.graphFocused', false]);
	});
});
