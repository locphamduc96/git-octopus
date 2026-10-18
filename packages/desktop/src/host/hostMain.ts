import * as path from 'node:path';
import type { MessagePortMain } from 'electron';
import {
	isDesktopViewMessage,
	pickAutoFetchMinutes,
	type HostToWebview,
	type WebviewToHost,
} from '@git-octopus/shared';
import type { ViewChannel } from '@git-octopus/host/app/ports/shell';
import { GitProcessExecutor } from '@git-octopus/host/adapters/process/gitProcessExecutor';
import {
	DEFAULT_GIT_PROGRAM,
	gitProgramFor,
	resolveGitProgram,
	setGitPathSource,
} from '@git-octopus/host/adapters/process/gitProgram';
import { LockRetryGitExecutor } from '@git-octopus/host/adapters/process/lockRetryGitExecutor';
import { SerializingGitExecutor } from '@git-octopus/host/adapters/process/serializingGitExecutor';
import type { AskpassServer } from '@git-octopus/host/adapters/askpass/askpassServer';
import { pathExists } from '@git-octopus/host/adapters/fs/pathExists';
import {
	GitOctopusController,
	STATE_VIEW_SETTINGS,
} from '@git-octopus/host/adapters/services/GitOctopusController';
import {
	CommitActionService,
	readHostViewSettings,
	type HostViewSettings,
} from '@git-octopus/host/adapters/services/CommitActionService';
import { WorkingTreeService } from '@git-octopus/host/adapters/services/WorkingTreeService';
import { RepoActionService } from '@git-octopus/host/adapters/services/RepoActionService';
import { CommitAgentService } from '@git-octopus/host/adapters/services/CommitAgentService';
import { AutoFetchScheduler } from '@git-octopus/host/adapters/services/AutoFetchScheduler';
import type { HostToMain, MainRpc, MainToHost } from '../ipc.js';
import { followSavedTheme } from '../themeSource.js';
import { createDesktopAskpass } from './askpassEnv.js';
import { DesktopShell } from './desktopShell.js';
import { GitAvailabilityExecutor } from './gitAvailability.js';
import { createRepoWatchSupervisor, type RepoWatchSupervisor } from './repoWatch.js';

/**
 * One window's host: the controller and every service, in a utility process of their own so a long
 * `git log` never stalls the window. Main hands over the renderer's end of a MessagePort; the
 * view's traffic never passes through main again.
 */
const parentPort = process.parentPort;
const send = (message: HostToMain): void => parentPort.postMessage(message);

let nextRpcId = 1;
const mapRpcPending = new Map<
	number,
	{ resolve: (value: unknown) => void; reject: (e: Error) => void }
>();
const rpc = <K extends keyof MainRpc>(
	method: K,
	...args: Parameters<MainRpc[K]>
): Promise<unknown> =>
	new Promise((resolve, reject) => {
		const id = nextRpcId++;
		mapRpcPending.set(id, { resolve, reject });
		send({ kind: 'rpc', id, method, args });
	});

let shell: DesktopShell | null = null;
let controller: GitOctopusController | null = null;
let focused = false;
/** Resolves once `start` has built the controller; a view that arrives sooner waits for it. */
let ready: Promise<void> = Promise.resolve();
/** The view now attached, and what tells the controller it is gone. */
let current: { view: ViewChannel; port: MessagePortMain; dispose: () => void } | null = null;
/** What to let go of when the host ends: the repository watcher and the askpass socket. */
const listCleanups: (() => void)[] = [];

const readViewSettings = (): HostViewSettings | null =>
	readHostViewSettings(shell?.globalState.get<unknown>(STATE_VIEW_SETTINGS));

/** The askpass bridge, or none: git then fails fast on a prompt, as it always did without one. */
async function startAskpass(init: Extract<MainToHost, { kind: 'init' }>, owner: DesktopShell) {
	try {
		const server: AskpassServer = createDesktopAskpass({
			distDir: __dirname,
			appBinary: init.appBinary,
			prompt: owner.credentialPrompt,
		});
		await server.start();
		listCleanups.push(() => {
			owner.credentialPrompt.cancelAll();
			server.dispose();
		});
		return server;
	} catch (error) {
		owner.log.line(
			`[askpass] not available — ${error instanceof Error ? error.message : String(error)}`
		);
		return undefined;
	}
}

async function start(init: Extract<MainToHost, { kind: 'init' }>): Promise<void> {
	focused = init.focused;
	setGitPathSource(() => readViewSettings()?.gitPath);
	let gitProgram = DEFAULT_GIT_PROGRAM;
	let git: GitAvailabilityExecutor | null = null;
	const owner = new DesktopShell({
		...init,
		rpc,
		readViewSettings,
		onViewSettingsSaved: (settings) => {
			followSavedTheme(settings, (source) => void rpc('setThemeSource', source));
			const nextProgram = gitProgramFor(settings?.gitPath);
			if (nextProgram !== gitProgram) {
				gitProgram = nextProgram;
				void git?.verify(init.folder);
			}
		},
	});
	shell = owner;
	gitProgram = resolveGitProgram();
	const askpass = await startAskpass(init, owner);
	git = new GitAvailabilityExecutor(new GitProcessExecutor(askpass), {
		program: resolveGitProgram,
		onUnavailable: (message) => void owner.notify.error(message),
	});
	const executor = new SerializingGitExecutor(new LockRetryGitExecutor(git));
	const created = new GitOctopusController(
		owner,
		executor,
		new CommitActionService(executor, owner, readViewSettings),
		new WorkingTreeService(executor, owner),
		new RepoActionService(executor, owner),
		new CommitAgentService(
			executor,
			owner,
			owner.globalState,
			undefined,
			path.join(init.dataDir, 'agent-workdir')
		)
	);
	controller = created;

	const watcher: RepoWatchSupervisor = createRepoWatchSupervisor({
		executor: git,
		onChange: (kind) => void created.autoRefresh(kind),
		onError: (error, watched) => owner.log.line(`[watch] ${watched} — ${error.message}`),
	});
	listCleanups.push(() => watcher.close());
	const followRepo = (): void => void watcher.follow(created.activeRepoPath);

	const status = { repoName: null as string | null, branch: null as string | null, changeCount: 0 };
	created.onChangeCount = (count) => {
		status.changeCount = count;
		send({ kind: 'status', ...status });
		followRepo();
	};
	created.onRepoState = ({ repoName, branch }) => {
		status.repoName = repoName;
		status.branch = branch;
		send({ kind: 'status', ...status });
		followRepo();
	};
	void created.primeChangeCount().then(followRepo);

	const autoFetch = new AutoFetchScheduler({
		executor,
		activeRepo: () => created.activeRepoPath,
		intervalMinutes: () => pickAutoFetchMinutes(readViewSettings()?.autoFetchMinutes),
		focused: () => focused,
		now: () => Date.now(),
		pathExists,
		onFetched: () => void created.autoRefresh('graph'),
		onGaveUp: (message) =>
			void owner.notify.warn(
				`Git Octopus: auto-fetch stopped after repeated failures — ${message}`
			),
	});
	autoFetch.start();
	listCleanups.push(() => autoFetch.dispose());
	void git.verify(init.folder);
}

/** A renderer is listening on `port`: drive it, and let go of the one before (a reload). */
function attachView(port: MessagePortMain): void {
	if (!shell || !controller) return;
	current?.dispose();
	const owner = shell;
	const listListeners: ((message: WebviewToHost) => unknown)[] = [];
	const listDisposers: (() => void)[] = [];
	const view: ViewChannel = {
		postMessage: (message: HostToWebview) => port.postMessage(message),
		onDidReceiveMessage: (listener) => void listListeners.push(listener),
	};
	port.on('message', (event) => {
		const message = event.data as WebviewToHost;
		// The window's own business: answered here, never passed to the controller.
		if (isDesktopViewMessage(message)) {
			owner.receiveDesktopMessage(message);
			return;
		}
		// `loadCommits` is the view saying it is listening: anything asked while it was not goes again.
		if (message.type === 'loadCommits') owner.deliverPending(view);
		for (const listener of listListeners) listener(message);
	});
	port.start();
	current = {
		view,
		port,
		dispose: () => {
			for (const disposer of listDisposers) disposer();
			owner.forgetView(view);
			port.close();
		},
	};
	void controller.attach(view, (listener) => listDisposers.push(listener));
}

function shutDown(): void {
	for (const cleanup of listCleanups.splice(0)) {
		try {
			cleanup();
		} catch {
			// Leaving must not fail halfway: the rest still has to be let go of.
		}
	}
}

// `utilityProcess.kill()` is a SIGTERM; the askpass socket folder and the watchers go with it.
process.once('SIGTERM', () => {
	shutDown();
	process.exit(0);
});
process.once('exit', shutDown);

parentPort.on('message', (event) => {
	const message = event.data as MainToHost;
	switch (message.kind) {
		case 'init':
			ready = start(message);
			// A host that could not start has no view to show it in; the log is where it is read.
			ready.catch((error: unknown) => {
				shell?.log.line(
					`[host] start failed — ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
				);
			});
			return;
		case 'view': {
			const port = event.ports[0];
			void ready.then(
				() => attachView(port),
				() => undefined
			);
			return;
		}
		case 'theme':
			shell?.setTheme(message.theme);
			void controller?.refreshIconTheme();
			return;
		case 'focus':
			focused = message.focused;
			return;
		case 'visible':
			if (current) controller?.setWebviewVisible(current.view, message.visible);
			return;
		case 'rpcResult': {
			const pending = mapRpcPending.get(message.id);
			mapRpcPending.delete(message.id);
			if (!pending) return;
			if (message.ok) pending.resolve(message.value);
			else pending.reject(new Error(message.error ?? 'failed'));
			return;
		}
	}
});
