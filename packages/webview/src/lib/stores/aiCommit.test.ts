import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostToWebview } from '@git-octopus/shared';

const readyInventory = {
	type: 'agentInventory',
	listAgents: [{ id: 'claude', label: 'Claude Code', version: '2.0.0', state: 'ready' }],
	savedAgentId: 'claude',
	consented: true,
	mapModels: { claude: '' },
	mapThinking: { claude: '' },
	language: '',
} as const satisfies HostToWebview;

const idleState = { type: 'commitPlanState', repoPath: '', status: 'idle' } as const satisfies HostToWebview;

const draft = {
	listGroups: [
		{ listFiles: ['a.ts'], subject: 'feat: a' },
		{ listFiles: ['b.ts'], subject: 'chore: b' },
	],
	single: { subject: 'feat: all' },
};

async function loadAiCommit(initialState?: unknown) {
	const listSent: { type: string; nonce?: number }[] = [];
	let stored: unknown = initialState;
	vi.stubGlobal('acquireVsCodeApi', () => ({
		postMessage: (message: unknown) => listSent.push(message as { type: string }),
		getState: () => stored,
		setState: (next: unknown) => (stored = next),
	}));
	vi.resetModules();
	const { aiCommit } = await import('./aiCommit.svelte');
	const { STATE_VERSION } = await import('../bridge');
	const { dispatchHostMessage, resetForRepo } = await import('../hostRouter');
	return {
		aiCommit,
		listSent,
		dispatchHostMessage,
		resetForRepo,
		STATE_VERSION,
		storedState: () => stored as { aiCommit?: { plan?: unknown } } | undefined,
	};
}

describe('aiCommit', () => {
	beforeEach(() => vi.unstubAllGlobals());

	it('asks for agents and for the host plan state on every opening', async () => {
		const { aiCommit, listSent } = await loadAiCommit();
		aiCommit.openDialog();
		expect(listSent.map((message) => message.type)).toEqual(['detectAgents', 'loadCommitPlanState']);
	});

	it('generates only after the host has said idle AND an agent is ready and consented', async () => {
		const { aiCommit, listSent, dispatchHostMessage } = await loadAiCommit();
		aiCommit.openDialog();
		dispatchHostMessage(readyInventory);
		// The inventory alone must not start a run — the host may hold a result to rehydrate.
		expect(aiCommit.phase).toBe('setup');

		dispatchHostMessage(idleState);
		expect(aiCommit.phase).toBe('generating');
		expect(listSent.at(-1)?.type).toBe('generateCommitPlan');
	});

	it('waits in setup when no consent has been given yet', async () => {
		const { aiCommit, dispatchHostMessage } = await loadAiCommit();
		aiCommit.openDialog();
		dispatchHostMessage(idleState);
		dispatchHostMessage({ ...readyInventory, consented: false, savedAgentId: null });
		expect(aiCommit.phase).toBe('setup');
	});

	it('shows the result and persists it for the next incarnation of the view', async () => {
		const { aiCommit, dispatchHostMessage, storedState } = await loadAiCommit();
		aiCommit.openDialog();
		dispatchHostMessage(readyInventory);
		dispatchHostMessage(idleState);
		dispatchHostMessage({ type: 'commitPlanResult', repoPath: '', generationId: 7, plan: draft });

		expect(aiCommit.phase).toBe('result');
		expect(aiCommit.mode).toBe('split');
		expect(storedState()?.aiCommit).toMatchObject({ repoPath: '', generationId: 7 });
	});

	it('ignores a cancelled result — cancellations are always this side\'s own doing', async () => {
		const { aiCommit, dispatchHostMessage } = await loadAiCommit();
		aiCommit.openDialog();
		dispatchHostMessage(readyInventory);
		dispatchHostMessage(idleState);
		dispatchHostMessage({ type: 'commitPlanResult', repoPath: '', generationId: 6, error: 'Cancelled.' });
		expect(aiCommit.phase).toBe('generating');

		dispatchHostMessage({ type: 'commitPlanResult', repoPath: '', generationId: 7, plan: draft });
		expect(aiCommit.phase).toBe('result');
	});

	it('rehydrates a run still in flight as the generating screen', async () => {
		const { aiCommit, dispatchHostMessage, listSent } = await loadAiCommit();
		aiCommit.openDialog();
		dispatchHostMessage({ type: 'commitPlanState', repoPath: '', status: 'running', generationId: 5 });
		dispatchHostMessage(readyInventory);

		expect(aiCommit.phase).toBe('generating');
		// And it must not have started a second run on top of the one in flight.
		expect(listSent.filter((message) => message.type === 'generateCommitPlan')).toHaveLength(0);
	});

	it('rehydrates a cached result that arrived while no view was there to hear it', async () => {
		const { aiCommit, dispatchHostMessage } = await loadAiCommit();
		aiCommit.openDialog(['a.ts', 'b.ts']);
		dispatchHostMessage({
			type: 'commitPlanState', repoPath: '', status: 'done', generationId: 5, plan: draft,
		});
		expect(aiCommit.phase).toBe('result');
		expect(aiCommit.plan?.listGroups).toHaveLength(2);
		// And it says so, so an old plan never masquerades as a fresh one.
		expect(aiCommit.restored).toBe(true);
	});

	it('lets a cached plan expire with the working tree it was made over', async () => {
		const { aiCommit, listSent, dispatchHostMessage } = await loadAiCommit();
		// One of the planned files is no longer changed, and a new file appeared.
		aiCommit.openDialog(['a.ts', 'new.ts']);
		dispatchHostMessage(readyInventory);
		dispatchHostMessage({
			type: 'commitPlanState', repoPath: '', status: 'done', generationId: 5, plan: draft,
		});
		// The stale plan is not shown; a fresh generation starts instead.
		expect(aiCommit.phase).toBe('generating');
		expect(listSent.filter((message) => message.type === 'generateCommitPlan')).toHaveLength(1);
	});

	it('prefers the persisted edited copy of the same generation over the host raw plan', async () => {
		const { STATE_VERSION } = await loadAiCommit();
		const edited = {
			listGroups: [{ listFiles: ['a.ts', 'b.ts'], subject: 'my own words', body: '' }],
			single: { subject: 'my single', body: '' },
		};
		const { aiCommit, dispatchHostMessage } = await loadAiCommit({
			version: STATE_VERSION,
			aiCommit: { repoPath: '', generationId: 5, plan: edited, mode: 'single' },
		});
		aiCommit.openDialog(['a.ts', 'b.ts']);
		dispatchHostMessage({
			type: 'commitPlanState', repoPath: '', status: 'done', generationId: 5, plan: draft,
		});
		expect(aiCommit.plan?.listGroups[0].subject).toBe('my own words');
		expect(aiCommit.mode).toBe('single');
	});

	it('restores a persisted plan across a window reload the host did not survive', async () => {
		const { STATE_VERSION } = await loadAiCommit();
		const edited = {
			listGroups: [{ listFiles: ['a.ts'], subject: 'kept', body: '' }],
			single: { subject: 'kept single', body: '' },
		};
		const { aiCommit, dispatchHostMessage, listSent } = await loadAiCommit({
			version: STATE_VERSION,
			aiCommit: { repoPath: '', generationId: null, plan: edited, mode: 'split' },
		});
		aiCommit.openDialog(['a.ts']);
		dispatchHostMessage(readyInventory);
		dispatchHostMessage(idleState);

		expect(aiCommit.phase).toBe('result');
		expect(aiCommit.plan?.listGroups[0].subject).toBe('kept');
		expect(listSent.filter((message) => message.type === 'generateCommitPlan')).toHaveLength(0);
	});

	it('keeps the run alive on close, and kills it only on an explicit cancel', async () => {
		const { aiCommit, listSent, dispatchHostMessage } = await loadAiCommit();
		aiCommit.openDialog();
		dispatchHostMessage(readyInventory);
		dispatchHostMessage(idleState);

		aiCommit.close();
		expect(listSent.filter((message) => message.type === 'cancelCommitPlan')).toHaveLength(0);

		aiCommit.openDialog();
		dispatchHostMessage({ type: 'commitPlanState', repoPath: '', status: 'running', generationId: 5 });
		aiCommit.cancelGenerate();
		expect(listSent.at(-1)?.type).toBe('cancelCommitPlan');
	});

	it('executes the edited plan, lands on the outcome, and spends the persisted copy', async () => {
		const { aiCommit, listSent, dispatchHostMessage, storedState } = await loadAiCommit();
		aiCommit.openDialog();
		dispatchHostMessage(readyInventory);
		dispatchHostMessage(idleState);
		dispatchHostMessage({ type: 'commitPlanResult', repoPath: '', generationId: 7, plan: draft });

		aiCommit.execute();
		expect(aiCommit.phase).toBe('executing');
		const request = listSent.at(-1) as { type: string; nonce: number; listGroups: unknown[] };
		expect(request.type).toBe('executeCommitPlan');
		expect(request.listGroups).toHaveLength(2);

		dispatchHostMessage({ type: 'commitPlanExecuted', nonce: request.nonce, committed: 2, total: 2 });
		expect(aiCommit.phase).toBe('done');
		expect(aiCommit.executed).toEqual({ committed: 2, total: 2, error: undefined });
		expect(storedState()?.aiCommit).toBeUndefined();
	});

	it('saves one setting at a time, and still sends both maps so the host reads no opinion', async () => {
		const { aiCommit, listSent } = await loadAiCommit();

		aiCommit.saveAiSettings({ language: 'Vietnamese' });
		expect(listSent.at(-1)).toEqual({
			type: 'saveAiSettings',
			mapModels: {},
			mapThinking: {},
			language: 'Vietnamese',
		});

		aiCommit.saveAiSettings({ agentId: 'codex' });
		expect(listSent.at(-1)).toEqual({
			type: 'saveAiSettings',
			agentId: 'codex',
			mapModels: {},
			mapThinking: {},
		});

		aiCommit.saveAiSettings({ mapModels: { claude: 'haiku' } });
		expect(listSent.at(-1)).toEqual({
			type: 'saveAiSettings',
			mapModels: { claude: 'haiku' },
			mapThinking: {},
		});
	});

	it('tells the host to clear the language, which an absent language must not do', async () => {
		const { aiCommit, listSent } = await loadAiCommit();
		aiCommit.saveAiSettings({ language: '' });
		expect(listSent.at(-1)).toHaveProperty('language', '');
	});

	it('closes and forgets the runtime state when the view moves to another repository', async () => {
		const { aiCommit, dispatchHostMessage, resetForRepo } = await loadAiCommit();
		aiCommit.openDialog();
		dispatchHostMessage(readyInventory);
		dispatchHostMessage(idleState);
		resetForRepo();
		expect(aiCommit.open).toBe(false);
		expect(aiCommit.plan).toBeNull();
	});
});
