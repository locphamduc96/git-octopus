import * as path from 'node:path';
import type { MessagePortMain } from 'electron';
import { pickAutoFetchMinutes, type HostToWebview, type WebviewToHost } from '@git-octopus/shared';
import type { ViewChannel } from '@git-octopus/host/app/ports/shell';
import { GitProcessExecutor } from '@git-octopus/host/adapters/process/gitProcessExecutor';
import { LockRetryGitExecutor } from '@git-octopus/host/adapters/process/lockRetryGitExecutor';
import { SerializingGitExecutor } from '@git-octopus/host/adapters/process/serializingGitExecutor';
import { pathExists } from '@git-octopus/host/adapters/fs/pathExists';
import {
	GitOctopusController,
	STATE_VIEW_SETTINGS,
} from '@git-octopus/host/adapters/services/GitOctopusController';
import {
	CommitActionService,
	readHostViewSettings,
} from '@git-octopus/host/adapters/services/CommitActionService';
import { WorkingTreeService } from '@git-octopus/host/adapters/services/WorkingTreeService';
import { RepoActionService } from '@git-octopus/host/adapters/services/RepoActionService';
import { CommitAgentService } from '@git-octopus/host/adapters/services/CommitAgentService';
import { AutoFetchScheduler } from '@git-octopus/host/adapters/services/AutoFetchScheduler';
import type { HostToMain, MainRpc, MainToHost } from '../ipc.js';
import { DesktopShell } from './desktopShell.js';

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
/** The view now attached, and what tells the controller it is gone. */
let current: { view: ViewChannel; port: MessagePortMain; dispose: () => void } | null = null;

function start(init: Extract<MainToHost, { kind: 'init' }>): void {
	focused = init.focused;
	const viewSettings = () =>
		readHostViewSettings(shell?.globalState.get<unknown>(STATE_VIEW_SETTINGS));
	shell = new DesktopShell({ ...init, rpc, readViewSettings: viewSettings });
	const executor = new SerializingGitExecutor(new LockRetryGitExecutor(new GitProcessExecutor()));
	controller = new GitOctopusController(
		shell,
		executor,
		new CommitActionService(executor, shell, viewSettings),
		new WorkingTreeService(executor, shell),
		new RepoActionService(executor, shell),
		new CommitAgentService(
			executor,
			shell,
			shell.globalState,
			undefined,
			path.join(init.dataDir, 'agent-workdir')
		)
	);
	const status = { repoName: null as string | null, branch: null as string | null, changeCount: 0 };
	controller.onChangeCount = (count) => {
		status.changeCount = count;
		send({ kind: 'status', ...status });
	};
	controller.onRepoState = ({ repoName, branch }) => {
		status.repoName = repoName;
		status.branch = branch;
		send({ kind: 'status', ...status });
	};
	void controller.primeChangeCount();

	const owner = controller;
	const autoFetch = new AutoFetchScheduler({
		executor,
		activeRepo: () => owner.activeRepoPath,
		intervalMinutes: () => pickAutoFetchMinutes(viewSettings()?.autoFetchMinutes),
		focused: () => focused,
		now: () => Date.now(),
		pathExists,
		onFetched: () => void owner.autoRefresh('graph'),
		onGaveUp: (message) =>
			void shell?.notify.warn(
				`Git Octopus: auto-fetch stopped after repeated failures — ${message}`
			),
	});
	autoFetch.start();
}

/** A renderer is listening on `port`: drive it, and let go of the one before (a reload). */
function attachView(port: MessagePortMain): void {
	if (!shell || !controller) return;
	current?.dispose();
	const listListeners: ((message: WebviewToHost) => unknown)[] = [];
	const listDisposers: (() => void)[] = [];
	const view: ViewChannel = {
		postMessage: (message: HostToWebview) => port.postMessage(message),
		onDidReceiveMessage: (listener) => void listListeners.push(listener),
	};
	port.on('message', (event) => {
		for (const listener of listListeners) listener(event.data as WebviewToHost);
	});
	port.start();
	const owner = shell;
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

parentPort.on('message', (event) => {
	const message = event.data as MainToHost;
	switch (message.kind) {
		case 'init':
			start(message);
			return;
		case 'view':
			attachView(event.ports[0]);
			return;
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
