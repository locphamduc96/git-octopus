import {
	LIST_AGENT_IDS,
	type AgentId,
	type AgentInventoryMessage,
	type CommitPlanProgress,
} from '@git-octopus/shared';
import { postToHost, readState, updateState, STATE_VERSION, type PersistedAiCommit } from '../bridge';
import { onHostType, onRepoReset } from '../hostRouter';
import { session } from './session.svelte';
import {
	buildExecuteGroups,
	listPlanFiles,
	moveFile,
	toEditablePlan,
	type CommitMode,
	type EditablePlan,
} from '../aiCommitPlan';

/**
 * The AI-commit dialog's state machine — a *view* over state that mostly lives elsewhere.
 *
 * The generation itself runs host-side and is cached there (`commitPlanState` says what the host
 * holds), and the plan being edited is persisted via the webview's `setState`, which the workbench
 * keeps across the view being destroyed and even across a window reload. What stays here is only
 * the conversation of the moment: which phase the dialog is showing, and the edits in progress.
 */

export type AiCommitPhase = 'setup' | 'generating' | 'result' | 'executing' | 'done';

let open = $state(false);
let phase = $state<AiCommitPhase>('setup');
let inventory = $state<AgentInventoryMessage | null>(null);
let plan = $state<EditablePlan | null>(null);
let mode = $state<CommitMode>('split');
let error = $state<{ message: string; needsLogin: boolean } | null>(null);
let executed = $state<{ committed: number; total: number; error?: string } | null>(null);
/** How far the run in flight has come — drives the step list in the generating view. */
let progress = $state<CommitPlanProgress | null>(null);
/** Which host generation `plan` came from; null when it survived a window reload the host did not. */
let planGenerationId: number | null = null;
/** True when the plan on screen was restored from a previous run rather than freshly generated. */
let restored = $state(false);
/** The changed paths as of the moment the dialog opened — what a cached plan must still cover. */
let setOpenPaths = new Set<string>();
/** Whether `commitPlanState` has answered for this opening — nothing auto-runs before it has. */
let stateResolved = false;
/** Execute stays nonce-matched in RAM: it is short-lived and never rehydrated. */
let executeNonce = 0;
let activeExecuteNonce = 0;

/** Read live, not captured at module init: a later persist must be visible to the next restore. */
function persistedForRepo(): PersistedAiCommit | null {
	const stored = readState();
	if (stored.version !== STATE_VERSION || !stored.aiCommit) return null;
	const saved = stored.aiCommit;
	if (saved.repoPath !== session.repoPath) return null;
	const savedPlan = saved.plan as EditablePlan | null;
	if (!savedPlan || !Array.isArray(savedPlan.listGroups) || !savedPlan.single) return null;
	return saved;
}

function persist(): void {
	if (!plan) return;
	updateState({
		aiCommit: {
			repoPath: session.repoPath,
			generationId: planGenerationId,
			// A deep `$state` proxy cannot be structured-cloned into storage.
			plan: JSON.parse(JSON.stringify(plan)) as EditablePlan,
			mode,
		},
	});
}

function clearPersisted(): void {
	updateState({ aiCommit: undefined });
}

function showPlan(next: EditablePlan, nextMode: CommitMode, generationId: number | null): void {
	plan = next;
	mode = nextMode;
	planGenerationId = generationId;
	error = null;
	phase = 'result';
}

/**
 * A plan is a function of the working tree: it is only worth showing again while it still covers
 * exactly the files that are changed now. Anything else is history wearing a plan's clothes.
 */
function planMatchesTree(candidate: EditablePlan): boolean {
	const listFiles = listPlanFiles(candidate);
	return listFiles.length === setOpenPaths.size && listFiles.every((file) => setOpenPaths.has(file));
}

function startGenerate(): void {
	phase = 'generating';
	plan = null;
	error = null;
	executed = null;
	progress = null;
	postToHost({ type: 'generateCommitPlan', repoPath: session.repoPath });
}

function maybeAutoGenerate(): void {
	if (!open || phase !== 'setup' || !stateResolved || error) return;
	const message = inventory;
	if (!message || !message.consented || message.savedAgentId === null) return;
	const saved = message.listAgents.find((agent) => agent.id === message.savedAgentId);
	if (saved?.state === 'ready') startGenerate();
}

onHostType('agentInventory', (message) => {
	inventory = message;
	maybeAutoGenerate();
});

onHostType('commitPlanState', (message) => {
	if (!open || stateResolved || message.repoPath !== session.repoPath) return;
	stateResolved = true;
	if (message.status === 'running') {
		phase = 'generating';
		progress = message.progress ?? null;
		return;
	}
	if (message.status === 'done') {
		if (message.plan) {
			// An edited copy of this same generation beats the host's raw plan.
			const saved = persistedForRepo();
			const candidate =
				saved && saved.generationId === (message.generationId ?? null)
					? { plan: saved.plan as EditablePlan, mode: saved.mode }
					: null;
			const fresh = toEditablePlan(message.plan);
			const chosenPlan = candidate?.plan ?? fresh;
			if (planMatchesTree(chosenPlan)) {
				showPlan(
					chosenPlan,
					candidate?.mode ?? (fresh.listGroups.length > 1 ? 'split' : 'single'),
					message.generationId ?? null
				);
				restored = true;
				if (!candidate) persist();
				return;
			}
			// The tree moved on since this plan was made — it expired with it.
			clearPersisted();
			maybeAutoGenerate();
			return;
		}
		error = {
			message: message.error ?? 'The agent returned nothing.',
			needsLogin: message.needsLogin === true,
		};
		return;
	}
	// Idle host. A plan persisted before a window reload is still the user's work in progress —
	// the host forgot it, the workbench did not — as long as it still fits the tree.
	const saved = persistedForRepo();
	if (saved && planMatchesTree(saved.plan as EditablePlan)) {
		showPlan(saved.plan as EditablePlan, saved.mode, saved.generationId);
		restored = true;
		return;
	}
	if (saved) clearPersisted();
	maybeAutoGenerate();
});

onHostType('commitPlanProgress', (message) => {
	if (message.repoPath !== session.repoPath) return;
	progress = message.progress;
});

onHostType('commitPlanResult', (message) => {
	if (!open || phase !== 'generating' || message.repoPath !== session.repoPath) return;
	// Every cancellation was ordered from this side (explicit, or superseded by a re-ask), so a
	// cancelled result is never news — and must not shout down the run that replaced it.
	if (message.error === 'Cancelled.') return;
	if (message.plan) {
		const fresh = toEditablePlan(message.plan);
		showPlan(fresh, fresh.listGroups.length > 1 ? 'split' : 'single', message.generationId);
		restored = false;
		persist();
		return;
	}
	error = {
		message: message.error ?? 'The agent returned nothing.',
		needsLogin: message.needsLogin === true,
	};
	phase = 'setup';
});

onHostType('commitPlanExecuted', (message) => {
	if (!open || phase !== 'executing' || message.nonce !== activeExecuteNonce) return;
	executed = { committed: message.committed, total: message.total, error: message.error };
	phase = 'done';
	if (!message.error) {
		clearPersisted();
		plan = null;
		planGenerationId = null;
	}
});

onRepoReset(() => {
	// Runtime only: the persisted plan is tagged with its repository and survives the switch.
	open = false;
	phase = 'setup';
	inventory = null;
	plan = null;
	planGenerationId = null;
	error = null;
	executed = null;
	progress = null;
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
	get restored(): boolean {
		return restored;
	},
	get progress(): CommitPlanProgress | null {
		return progress;
	},

	openDialog(listChangedPaths: string[] = []): void {
		open = true;
		phase = 'setup';
		plan = null;
		planGenerationId = null;
		error = null;
		executed = null;
		progress = null;
		inventory = null;
		stateResolved = false;
		restored = false;
		setOpenPaths = new Set(listChangedPaths);
		// Two questions, one decision: what agents exist, and what the host already holds for this
		// repository. The state answer decides between rehydrate, "still generating", and a fresh
		// run; the inventory only auto-starts that fresh run once the state has said "idle".
		postToHost({ type: 'detectAgents' });
		postToHost({ type: 'loadCommitPlanState', repoPath: session.repoPath });
	},

	/** Picking an agent is the consent; the host's inventory ack then starts the generation. */
	chooseAgent(agentId: string): void {
		if (!(LIST_AGENT_IDS as readonly string[]).includes(agentId)) return;
		postToHost({ type: 'selectAgent', agentId: agentId as AgentId });
	},

	regenerate(): void {
		if (phase === 'generating' || phase === 'executing') return;
		clearPersisted();
		startGenerate();
	},

	setMode(next: CommitMode): void {
		mode = next;
		persist();
	},
	setSingleSubject(subject: string): void {
		if (!plan) return;
		plan.single.subject = subject;
		persist();
	},
	setSingleBody(body: string): void {
		if (!plan) return;
		plan.single.body = body;
		persist();
	},
	setGroupSubject(index: number, subject: string): void {
		const group = plan?.listGroups[index];
		if (!group) return;
		group.subject = subject;
		persist();
	},
	setGroupBody(index: number, body: string): void {
		const group = plan?.listGroups[index];
		if (!group) return;
		group.body = body;
		persist();
	},
	moveFileTo(path: string, toIndex: number): void {
		if (!plan) return;
		plan = moveFile(plan, path, toIndex);
		persist();
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
		activeExecuteNonce = ++executeNonce;
		postToHost({
			type: 'executeCommitPlan',
			repoPath: session.repoPath,
			nonce: activeExecuteNonce,
			listGroups: built.listGroups,
		});
	},

	/** Refresh the agent inventory without opening the dialog (the settings tab's loader). */
	loadInventory(): void {
		postToHost({ type: 'detectAgents' });
	},

	/**
	 * The settings tab's save; the host answers every view with a fresh inventory.
	 *
	 * Every caller changes one thing, so everything is optional here — but the wire message keeps
	 * both maps required, and an absent one has to travel as empty rather than as nothing: the host
	 * merges what it is given, and a missing key would read as "no opinion", not "no change".
	 */
	saveAiSettings(input: {
		agentId?: AgentId;
		mapModels?: Partial<Record<AgentId, string>>;
		mapThinking?: Partial<Record<AgentId, string>>;
		language?: string;
	}): void {
		postToHost({
			type: 'saveAiSettings',
			...(input.agentId ? { agentId: input.agentId } : {}),
			mapModels: input.mapModels ?? {},
			mapThinking: input.mapThinking ?? {},
			...(input.language === undefined ? {} : { language: input.language }),
		});
	},

	openLoginTerminal(): void {
		postToHost({ type: 'openTerminal' });
	},

	/** Kill the run in flight. Closing the dialog does NOT do this — see `close`. */
	cancelGenerate(): void {
		postToHost({ type: 'cancelCommitPlan', repoPath: session.repoPath });
		open = false;
		phase = 'setup';
	},

	/**
	 * Just puts the dialog away. A generation in flight keeps running host-side; its result waits
	 * in the host cache and greets the next opening.
	 */
	close(): void {
		open = false;
	},
};
