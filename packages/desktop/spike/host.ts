import { appendFileSync } from 'node:fs';
import * as path from 'node:path';
import type { MessagePortMain } from 'electron';
import type { GraphFilters, HostToWebview, WebviewToHost } from '@git-octopus/shared';
import { routeMessage } from '@git-octopus/host/app/messageRouter';
import type { RepoContext } from '@git-octopus/host/app/useCases/loadCommits';
import { GitProcessExecutor } from '@git-octopus/host/adapters/process/gitProcessExecutor';
import { readBlob } from '@git-octopus/host/adapters/process/blobReader';
import { pathExists } from '@git-octopus/host/adapters/fs/pathExists';

/**
 * The read-only host of the spike: every query the graph, the details and the diff panel make,
 * answered by the same use cases the extension routes to. Writes and VS Code-only messages are
 * logged and dropped. Each answer's time and size go to GIT_OCTOPUS_SPIKE_LOG for the measuring run.
 */
const at = process.argv.indexOf('--repo');
const repo = at === -1 ? process.cwd() : process.argv[at + 1];
const metricsLog = process.env.GIT_OCTOPUS_SPIKE_LOG;

const ctx: RepoContext = {
	executor: new GitProcessExecutor(),
	repos: [{ path: repo, name: path.basename(repo) }],
	cwd: repo,
	repoName: path.basename(repo),
	pathExists,
	readBlob,
};
let filters: GraphFilters = { branch: null, showRemoteBranches: true };
let booted = false;

function record(entry: Record<string, unknown>): void {
	if (metricsLog) appendFileSync(metricsLog, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
}

async function handle(port: MessagePortMain, message: WebviewToHost): Promise<void> {
	const post = (reply: HostToWebview): void => port.postMessage(reply);
	if (message.type === 'loadCommits') {
		if (!booted) {
			booted = true;
			post({ type: 'viewSettings', settings: null });
			post({ type: 'fileIcons', theme: null });
			post({ type: 'colorTheme', kind: 'dark' });
		}
		filters = message.filters ?? filters;
	}
	const started = performance.now();
	const reply = await routeMessage(message, ctx, filters).catch(
		(error: unknown): HostToWebview => ({
			type: 'error',
			message: error instanceof Error ? error.message : String(error),
			repos: ctx.repos,
			activeRepo: ctx.cwd,
		})
	);
	if (!reply) {
		record({ type: message.type, handled: false });
		return;
	}
	const ms = performance.now() - started;
	post(reply);
	record({
		type: message.type,
		ms: Math.round(ms),
		bytes: JSON.stringify(reply).length,
		...(reply.type === 'commits' ? { commits: reply.commits.length } : {}),
	});
}

process.parentPort.once('message', (event) => {
	const [port] = event.ports;
	port.on('message', (message) => void handle(port, message.data as WebviewToHost));
	port.start();
});
