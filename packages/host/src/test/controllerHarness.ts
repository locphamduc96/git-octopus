import type { HostToWebview, WebviewToHost } from '@git-octopus/shared';
import type { GitExecutor } from '../core/git/GitExecutor.js';
import { GitOctopusController } from '../adapters/services/GitOctopusController.js';
import type { CommitActionService } from '../adapters/services/CommitActionService.js';
import type { CommitAgentService } from '../adapters/services/CommitAgentService.js';
import type { RepoActionService } from '../adapters/services/RepoActionService.js';
import type { WorkingTreeService } from '../adapters/services/WorkingTreeService.js';
import type { ControllerShell, EditorDiff } from '../app/ports/shell.js';
import { controllerShell, IDLE_DIFF, memento, type FakeMemento } from './fakeShell.js';

export { memento, type FakeMemento };

/**
 * A webview that keeps everything the host said to it and can talk back.
 *
 * The controller's whole job is deciding which view hears what, so a test needs one recorder per
 * view — and it must be a distinct object identity, since the controller keys its per-view maps
 * (limit, visibility, prompt broker) on the webview itself.
 */
export class FakeWebview {
	public readonly listPosted: HostToWebview[] = [];
	private handler: ((message: WebviewToHost) => unknown) | null = null;

	public onDidReceiveMessage(handler: (message: WebviewToHost) => unknown): void {
		this.handler = handler;
	}

	public postMessage(message: HostToWebview): Promise<boolean> {
		this.listPosted.push(message);
		return Promise.resolve(true);
	}

	/**
	 * Deliver a message the way the editor would, through `handleMessage` — so a test also covers
	 * the error funnel that turns a throw into a drawable reply instead of a silent hang.
	 *
	 * The returned promise settles when the host is done with the message, which for anything that
	 * asks the user is only after the answer arrives. Await it accordingly.
	 */
	public receive(message: WebviewToHost): Promise<void> {
		return Promise.resolve(this.handler?.(message)).then(() => undefined);
	}

	public postedOfType<T extends HostToWebview['type']>(
		type: T
	): Extract<HostToWebview, { type: T }>[] {
		return this.listPosted.filter(
			(message): message is Extract<HostToWebview, { type: T }> => message.type === type
		);
	}

	/** Message types in the order they arrived — what an "open the view" sequence looks like. */
	public get listTypes(): string[] {
		return this.listPosted.map((message) => message.type);
	}
}

export interface AttachedView {
	webview: FakeWebview;
	/** Fire the disposer the controller registered, as the container does when the view closes. */
	dispose: () => void;
}

export async function attachView(controller: GitOctopusController): Promise<AttachedView> {
	const webview = new FakeWebview();
	const listDisposers: (() => void)[] = [];
	await controller.attach(webview, (listener) => listDisposers.push(listener));
	return {
		webview,
		dispose: () => {
			for (const disposer of listDisposers) disposer();
		},
	};
}

/*
 * The five injected services are classes with private fields, so no object literal can ever be
 * assignable to one. `Pick` of the methods the controller actually calls keeps the fakes typed,
 * and the single `as unknown as` per service is confined to `makeController` below.
 */
export type DiffFake = Partial<EditorDiff>;
export type ActionsFake = Partial<
	Pick<CommitActionService, 'run' | 'squash' | 'runMulti' | 'runBranchAction' | 'canFastForward'>
>;
export type WorkingTreeFake = Partial<Pick<WorkingTreeService, 'run'>>;
export type RepoActionsFake = Partial<
	Pick<RepoActionService, 'run' | 'runSequencer' | 'runRemoteAction'>
>;
export type CommitAgentFake = Partial<
	Pick<
		CommitAgentService,
		'detect' | 'saveSettings' | 'select' | 'generate' | 'cancel' | 'state' | 'execute'
	>
>;

/** Answers nothing to everything: a repository with no output is still a valid repository. */
const SILENT_GIT: GitExecutor = { run: () => Promise.resolve('') };

/** `false` means "nothing changed", so the controller does not chase every action with a reload. */
const IDLE_ACTIONS: ActionsFake = {
	run: () => Promise.resolve(false),
	squash: () => Promise.resolve(false),
	runMulti: () => Promise.resolve(false),
	runBranchAction: () => Promise.resolve(false),
	canFastForward: () => Promise.resolve(false),
};

const IDLE_WORKING_TREE: WorkingTreeFake = { run: () => Promise.resolve(false) };

const IDLE_REPO_ACTIONS: RepoActionsFake = {
	run: () => Promise.resolve(false),
	runSequencer: () => Promise.resolve(false),
	runRemoteAction: () => Promise.resolve(false),
};

const IDLE_AGENT: CommitAgentFake = {
	detect: () =>
		Promise.resolve({
			type: 'agentInventory',
			listAgents: [],
			savedAgentId: null,
			consented: false,
			mapModels: {},
			mapThinking: {},
			language: '',
		}),
	saveSettings: () => Promise.resolve(),
	select: () => Promise.resolve(),
	cancel: () => undefined,
	state: (repoPath) => ({ type: 'commitPlanState', repoPath, status: 'idle' }),
	generate: (message) =>
		Promise.resolve({
			type: 'commitPlanResult',
			repoPath: message.repoPath,
			generationId: 0,
			error: 'no agent',
		}),
	execute: (message) =>
		Promise.resolve({
			type: 'commitPlanExecuted',
			nonce: message.nonce,
			committed: 0,
			total: message.listGroups.length,
		}),
};

export interface ControllerFakes {
	executor?: GitExecutor;
	diff?: DiffFake;
	actions?: ActionsFake;
	workingTree?: WorkingTreeFake;
	repoActions?: RepoActionsFake;
	commitAgent?: CommitAgentFake;
	workspaceState?: FakeMemento;
	globalState?: FakeMemento;
	/** The folders searched for repositories — the workspace folders, in VS Code. */
	listRoots?: string[];
	/** Anything else the shell should answer differently. */
	shell?: Partial<ControllerShell>;
}

export function makeController(fakes: ControllerFakes = {}): GitOctopusController {
	return new GitOctopusController(
		controllerShell({
			editorDiff: { ...IDLE_DIFF, ...fakes.diff },
			workspaceState: fakes.workspaceState ?? memento(),
			globalState: fakes.globalState ?? memento(),
			listRoots: () => fakes.listRoots ?? [],
			...fakes.shell,
		}),
		fakes.executor ?? SILENT_GIT,
		{ ...IDLE_ACTIONS, ...fakes.actions } as unknown as CommitActionService,
		{ ...IDLE_WORKING_TREE, ...fakes.workingTree } as unknown as WorkingTreeService,
		{ ...IDLE_REPO_ACTIONS, ...fakes.repoActions } as unknown as RepoActionService,
		{ ...IDLE_AGENT, ...fakes.commitAgent } as unknown as CommitAgentService
	);
}
