import type { AgentInventoryMessage } from '@git-octopus/shared';
import { postToHost } from '../bridge';
import { onHostType, onRepoReset } from '../hostRouter';
import { session } from './session.svelte';
import {
	buildExecuteGroups,
	moveFile,
	toEditablePlan,
	type CommitMode,
	type EditablePlan,
} from '../aiCommitPlan';

/**
 * The AI-commit dialog's state machine. One flight at a time: every generate/execute gets a fresh
 * nonce, and a reply that does not carry the current one belongs to a dialog that no longer
 * exists — cancelled, closed, or re-run — and is dropped.
 */

export type AiCommitPhase = 'setup' | 'generating' | 'result' | 'executing' | 'done';

let open = $state(false);
let phase = $state<AiCommitPhase>('setup');
let inventory = $state<AgentInventoryMessage | null>(null);
let plan = $state<EditablePlan | null>(null);
let mode = $state<CommitMode>('split');
let error = $state<{ message: string; needsLogin: boolean } | null>(null);
let executed = $state<{ committed: number; total: number; error?: string } | null>(null);
/** Plain, not rendered: only ever compared against incoming replies. */
let nonce = 0;
let activeNonce = 0;

function startGenerate(): void {
	phase = 'generating';
	plan = null;
	error = null;
	executed = null;
	activeNonce = ++nonce;
	postToHost({ type: 'generateCommitPlan', repoPath: session.repoPath, nonce: activeNonce });
}

function readyIds(message: AgentInventoryMessage): string[] {
	return message.listAgents.filter((agent) => agent.state === 'ready').map((agent) => agent.id);
}

onHostType('agentInventory', (message) => {
	inventory = message;
	// The inventory doubles as the ack for `selectAgent`: once it reports a consented, still-
	// installed pick while the dialog waits in setup, generation starts without another click.
	if (
		open &&
		phase === 'setup' &&
		message.consented &&
		message.savedAgentId !== null &&
		readyIds(message).includes(message.savedAgentId)
	) {
		startGenerate();
	}
});

onHostType('commitPlanResult', (message) => {
	if (!open || phase !== 'generating' || message.nonce !== activeNonce) return;
	if (message.plan) {
		plan = toEditablePlan(message.plan);
		mode = plan.listGroups.length > 1 ? 'split' : 'single';
		phase = 'result';
		return;
	}
	error = { message: message.error ?? 'The agent returned nothing.', needsLogin: message.needsLogin === true };
	phase = 'setup';
});

onHostType('commitPlanExecuted', (message) => {
	if (!open || phase !== 'executing' || message.nonce !== activeNonce) return;
	executed = { committed: message.committed, total: message.total, error: message.error };
	phase = 'done';
});

onRepoReset(() => {
	open = false;
	phase = 'setup';
	inventory = null;
	plan = null;
	error = null;
	executed = null;
});

export const aiCommit = {
	get open(): boolean {
		return open;
	},
	get phase(): AiCommitPhase {
		return phase;
	},
	get inventory(): AgentInventoryMessage | null {
		return inventory;
	},
	get plan(): EditablePlan | null {
		return plan;
	},
	get mode(): CommitMode {
		return mode;
	},
	get error(): { message: string; needsLogin: boolean } | null {
		return error;
	},
	get executed(): { committed: number; total: number; error?: string } | null {
		return executed;
	},

	openDialog(): void {
		open = true;
		phase = 'setup';
		plan = null;
		error = null;
		executed = null;
		// Always re-detect: a CLI installed or logged in since last time must show up now,
		// and the reply is also what auto-starts generation for a returning user.
		inventory = null;
		postToHost({ type: 'detectAgents' });
	},

	/** Picking an agent is the consent; the host's inventory ack then starts the generation. */
	chooseAgent(agentId: string): void {
		if (agentId !== 'claude' && agentId !== 'codex') return;
		postToHost({ type: 'selectAgent', agentId });
	},

	regenerate(): void {
		if (phase === 'generating' || phase === 'executing') return;
		startGenerate();
	},

	setMode(next: CommitMode): void {
		mode = next;
	},
	setSingleSubject(subject: string): void {
		if (plan) plan.single.subject = subject;
	},
	setSingleBody(body: string): void {
		if (plan) plan.single.body = body;
	},
	setGroupSubject(index: number, subject: string): void {
		const group = plan?.listGroups[index];
		if (group) group.subject = subject;
	},
	setGroupBody(index: number, body: string): void {
		const group = plan?.listGroups[index];
		if (group) group.body = body;
	},
	moveFileTo(path: string, toIndex: number): void {
		if (plan) plan = moveFile(plan, path, toIndex);
	},

	execute(): void {
		if (!plan || phase !== 'result') return;
		const built = buildExecuteGroups(plan, mode);
		if ('error' in built) {
			error = { message: built.error, needsLogin: false };
			return;
		}
		error = null;
		phase = 'executing';
		activeNonce = ++nonce;
		postToHost({
			type: 'executeCommitPlan',
			repoPath: session.repoPath,
			nonce: activeNonce,
			listGroups: built.listGroups,
		});
	},

	openLoginTerminal(): void {
		postToHost({ type: 'openTerminal' });
	},

	close(): void {
		if (phase === 'generating') {
			postToHost({ type: 'cancelCommitPlan', nonce: activeNonce });
		}
		open = false;
	},
};
