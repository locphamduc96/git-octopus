import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostToWebview } from '@git-octopus/shared';

const readyInventory = {
	type: 'agentInventory',
	listAgents: [{ id: 'claude', label: 'Claude Code', version: '2.0.0', state: 'ready' }],
	savedAgentId: 'claude',
	consented: true,
} as const satisfies HostToWebview;

const draft = {
	listGroups: [
		{ listFiles: ['a.ts'], subject: 'feat: a' },
		{ listFiles: ['b.ts'], subject: 'chore: b' },
	],
	single: { subject: 'feat: all' },
};

async function loadAiCommit() {
	const listSent: { type: string; nonce?: number }[] = [];
	vi.stubGlobal('acquireVsCodeApi', () => ({
		postMessage: (message: unknown) => listSent.push(message as { type: string }),
		getState: () => undefined,
		setState: () => undefined,
	}));
	vi.resetModules();
	const { aiCommit } = await import('./aiCommit.svelte');
	const { dispatchHostMessage, resetForRepo } = await import('../hostRouter');
	return { aiCommit, listSent, dispatchHostMessage, resetForRepo };
}

describe('aiCommit', () => {
	beforeEach(() => vi.unstubAllGlobals());

	it('re-detects agents on every opening, then generates once the inventory allows it', async () => {
		const { aiCommit, listSent, dispatchHostMessage } = await loadAiCommit();
		aiCommit.openDialog();
		expect(listSent.map((message) => message.type)).toEqual(['detectAgents']);

		dispatchHostMessage(readyInventory);
		expect(aiCommit.phase).toBe('generating');
		expect(listSent.at(-1)?.type).toBe('generateCommitPlan');
	});

	it('waits in setup when no consent has been given yet', async () => {
		const { aiCommit, dispatchHostMessage } = await loadAiCommit();
		aiCommit.openDialog();
		dispatchHostMessage({ ...readyInventory, consented: false, savedAgentId: null });
		expect(aiCommit.phase).toBe('setup');
	});

	it('accepts only the reply to the flight it is waiting for', async () => {
		const { aiCommit, listSent, dispatchHostMessage } = await loadAiCommit();
		aiCommit.openDialog();
		dispatchHostMessage(readyInventory);
		const nonce = (listSent.at(-1) as { nonce: number }).nonce;

		dispatchHostMessage({ type: 'commitPlanResult', nonce: nonce + 99, plan: draft });
		expect(aiCommit.phase).toBe('generating');

		dispatchHostMessage({ type: 'commitPlanResult', nonce, plan: draft });
		expect(aiCommit.phase).toBe('result');
		// Two proposed groups → the split is the suggestion the dialog opens on.
		expect(aiCommit.mode).toBe('split');
		expect(aiCommit.plan?.listGroups).toHaveLength(2);
	});

	it('cancels the running generation when the dialog closes on it', async () => {
		const { aiCommit, listSent, dispatchHostMessage } = await loadAiCommit();
		aiCommit.openDialog();
		dispatchHostMessage(readyInventory);
		aiCommit.close();
		expect(listSent.at(-1)?.type).toBe('cancelCommitPlan');
	});

	it('reports a login problem as an error state, not a plan', async () => {
		const { aiCommit, listSent, dispatchHostMessage } = await loadAiCommit();
		aiCommit.openDialog();
		dispatchHostMessage(readyInventory);
		const nonce = (listSent.at(-1) as { nonce: number }).nonce;
		dispatchHostMessage({ type: 'commitPlanResult', nonce, error: 'not logged in', needsLogin: true });
		expect(aiCommit.error?.needsLogin).toBe(true);
		expect(aiCommit.phase).toBe('setup');
	});

	it('executes the edited plan and lands on the outcome', async () => {
		const { aiCommit, listSent, dispatchHostMessage } = await loadAiCommit();
		aiCommit.openDialog();
		dispatchHostMessage(readyInventory);
		const nonce = (listSent.at(-1) as { nonce: number }).nonce;
		dispatchHostMessage({ type: 'commitPlanResult', nonce, plan: draft });

		aiCommit.execute();
		expect(aiCommit.phase).toBe('executing');
		const request = listSent.at(-1) as { type: string; nonce: number; listGroups: unknown[] };
		expect(request.type).toBe('executeCommitPlan');
		expect(request.listGroups).toHaveLength(2);

		dispatchHostMessage({ type: 'commitPlanExecuted', nonce: request.nonce, committed: 2, total: 2 });
		expect(aiCommit.phase).toBe('done');
		expect(aiCommit.executed).toEqual({ committed: 2, total: 2, error: undefined });
	});

	it('closes and forgets everything when the view moves to another repository', async () => {
		const { aiCommit, dispatchHostMessage, resetForRepo } = await loadAiCommit();
		aiCommit.openDialog();
		dispatchHostMessage(readyInventory);
		resetForRepo();
		expect(aiCommit.open).toBe(false);
		expect(aiCommit.plan).toBeNull();
	});
});
