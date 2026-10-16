import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import {
	_electron as electron,
	expect,
	test,
	type ElectronApplication,
	type FrameLocator,
	type Page,
} from '@playwright/test';
import { EXTENSION_ROOT, REPO_ROOT, STATE_DIR } from '../src/paths.js';
import { launchEnv, runCommand, SETTINGS } from '../src/session.js';
import { vscodeExecutable } from '../src/vscodeBinary.js';

/*
 * feature-113a: the same walk through the same large repository, once in the Electron spike and
 * once as the extension inside the pinned VS Code. Numbers go to `.cache/perf-results.json`.
 * The window must stay in front while it runs — a background window has its frames throttled.
 */
/** git/git: 82 k commits, an extreme lane count (`seen` merges every topic). svelte: an everyday shape. */
const LIST_PERF_REPOS = ['git', 'svelte'];
const perfRepo = (name: string): string => path.join(STATE_DIR, 'perf-repos', name);
const DESKTOP_ROOT = path.join(REPO_ROOT, 'packages/desktop');
const RESULTS = path.join(STATE_DIR, 'perf-results.json');
const TARGET_ROWS = 5000;

interface Shell {
	app: ElectronApplication;
	page: Page;
	graph: Page | FrameLocator;
	pid: number;
}

const mapResults: Record<string, unknown> = {};

/** RSS of a process and all of its descendants, in MB — the same measure for both shells. */
function treeRssMb(rootPid: number): number {
	const output = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' });
	const mapChildren = new Map<number, number[]>();
	const mapRss = new Map<number, number>();
	for (const line of output.trim().split('\n')) {
		const [pid, ppid, rss] = line.trim().split(/\s+/).map(Number);
		mapRss.set(pid, rss);
		mapChildren.set(ppid, [...(mapChildren.get(ppid) ?? []), pid]);
	}
	let total = 0;
	const listQueue = [rootPid];
	while (listQueue.length > 0) {
		const pid = listQueue.pop() as number;
		total += mapRss.get(pid) ?? 0;
		listQueue.push(...(mapChildren.get(pid) ?? []));
	}
	return Math.round(total / 1024);
}

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function loadedRows(shell: Shell): Promise<number> {
	return shell.graph.locator('.scroll').evaluate((el) => {
		const row = el.querySelector('.row');
		const inner = el.querySelector('.inner') as HTMLElement | null;
		if (!row || !inner) return 0;
		return Math.round(inner.offsetHeight / row.getBoundingClientRect().height);
	});
}

async function waitRows(shell: Shell, atLeast: number): Promise<void> {
	await expect.poll(() => loadedRows(shell), { timeout: 120_000 }).toBeGreaterThanOrEqual(atLeast);
}

async function setCommitsPerLoad(shell: Shell, limit: string): Promise<void> {
	const settings = shell.graph.locator('[role="dialog"][aria-label="Settings"]');
	await shell.graph.getByRole('button', { name: 'Settings', exact: true }).first().click();
	await settings
		.locator('.row', { hasText: 'Commits to load' })
		.locator('select')
		.selectOption(limit);
	await settings.getByRole('button', { name: 'Close settings' }).click();
}

/** Frame times while scrolling: `step` px a frame, or the whole list across `frames` when 0. */
async function scrollFrames(shell: Shell, step: number, frames = 240) {
	return shell.graph.locator('.scroll').evaluate(
		async (el, { step, frames }) => {
			const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
			el.scrollTop = 0;
			await nextFrame();
			await nextFrame();
			const listDeltas: number[] = [];
			const span = el.scrollHeight - el.clientHeight;
			let last = await nextFrame();
			for (let i = 1; i <= frames; i++) {
				el.scrollTop = step > 0 ? i * step : (span * i) / frames;
				const now = await nextFrame();
				listDeltas.push(now - last);
				last = now;
			}
			listDeltas.sort((a, b) => a - b);
			const pick = (q: number) => Math.round(listDeltas[Math.floor((frames - 1) * q)] * 10) / 10;
			return {
				medianMs: pick(0.5),
				p95Ms: pick(0.95),
				maxMs: pick(1),
				fps: Math.round(1000 / pick(0.5)),
			};
		},
		{ step, frames }
	);
}

async function graphWidth(shell: Shell): Promise<number> {
	return shell.graph
		.locator('.scroll svg.lines')
		.first()
		.evaluate((el) => Number(el.getAttribute('width')));
}

/** Per-process memory, from Electron itself — only the spike can ask; VS Code answers null. */
async function processMetrics(shell: Shell) {
	if (!('goto' in shell.graph)) return null;
	return shell.app.evaluate(({ app }) =>
		app.getAppMetrics().map((metric) => ({
			type: metric.type,
			name: metric.name ?? metric.serviceName ?? '',
			workingSetMb: Math.round(metric.memory.workingSetSize / 1024),
		}))
	);
}

/** The whole walk; every number is keyed under `name`. */
async function walk(
	name: string,
	shell: Shell,
	openGraph: () => Promise<void>,
	/** When the clock starts: the app's launch for the spike, the command for VS Code (already open). */
	startedAt = Date.now()
): Promise<void> {
	const mapOut: Record<string, unknown> = {};
	mapOut.rssBeforeGraphMb = treeRssMb(shell.pid);
	await openGraph();
	await shell.graph.locator('.scroll .row').first().waitFor({ timeout: 120_000 });
	mapOut.firstRowMs = Date.now() - startedAt;
	await settle(3000);
	mapOut.rssAt300Mb = treeRssMb(shell.pid);
	mapOut.graphPxAt300 = await graphWidth(shell);
	mapOut.processesAt300 = await processMetrics(shell);

	await setCommitsPerLoad(shell, '1000');
	await waitRows(shell, 1000);
	const listLoads: { rows: number; ms: number }[] = [];
	for (let target = 2000; target <= TARGET_ROWS; target += 1000) {
		const at = Date.now();
		await shell.graph.locator('.scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
		await waitRows(shell, target);
		listLoads.push({ rows: target, ms: Date.now() - at });
	}
	mapOut.loadMore = listLoads;
	await settle(2000);
	mapOut.wheelScroll = await scrollFrames(shell, 40);
	mapOut.jumpScroll = await scrollFrames(shell, 0);
	await settle(2000);
	mapOut.rssAt5000Mb = treeRssMb(shell.pid);
	mapOut.graphPxAt5000 = await graphWidth(shell);
	mapOut.processesAt5000 = await processMetrics(shell);

	await shell.graph.locator('.scroll').evaluate((el) => (el.scrollTop = 0));
	await shell.graph
		.locator('.scroll .row')
		.nth(5)
		.click({ position: { x: 40, y: 10 } });
	const fileRow = shell.graph.locator('.file-row button.open').first();
	await fileRow.waitFor({ timeout: 60_000 });
	const diffAt = Date.now();
	await fileRow.click();
	await shell.graph.locator('.diff .viewport').first().waitFor({ timeout: 60_000 });
	mapOut.diffOpenMs = Date.now() - diffAt;
	await settle(2000);
	mapOut.rssAfterDiffMb = treeRssMb(shell.pid);
	mapResults[name] = mapOut;
	writeFileSync(RESULTS, JSON.stringify(mapResults, null, '\t'));
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
	for (const name of LIST_PERF_REPOS) {
		if (!existsSync(perfRepo(name))) {
			throw new Error(
				`Clone the measuring repos first, blobless, into ${path.dirname(perfRepo(name))}`
			);
		}
		// A blobless clone fetches file contents on first use; fetch the first commits' now, so the
		// diff timing measures the view and not the network.
		execFileSync('git', ['-C', perfRepo(name), 'log', '-12', '-p', '--format=%H'], {
			stdio: 'ignore',
		});
	}
});

for (const repoName of LIST_PERF_REPOS)
	for (const run of ['cold', 'warm']) {
		const PERF_REPO = perfRepo(repoName);
		test(`desktop spike ${repoName} (${run})`, async () => {
			const userData = path.join(STATE_DIR, 'perf-desktop-user-data');
			if (run === 'cold') rmSync(userData, { recursive: true, force: true });
			mkdirSync(userData, { recursive: true });
			const metricsLog = path.join(STATE_DIR, `perf-desktop-host-${repoName}-${run}.jsonl`);
			rmSync(metricsLog, { force: true });
			const require = createRequire(path.join(DESKTOP_ROOT, 'package.json'));
			const executablePath = require('electron') as unknown as string;
			const launchedAt = Date.now();
			const app = await electron.launch({
				executablePath,
				args: [
					path.join(DESKTOP_ROOT, 'spike/dist/main.js'),
					'--repo',
					PERF_REPO,
					`--user-data-dir=${userData}`,
				],
				env: {
					...launchEnv(path.join(STATE_DIR, 'perf-agent.txt')),
					GIT_OCTOPUS_SPIKE_LOG: metricsLog,
				},
			});
			try {
				const page = await app.firstWindow();
				const shell: Shell = { app, page, graph: page, pid: app.process().pid ?? 0 };
				await walk(`desktop-${repoName}-${run}`, shell, async () => {}, launchedAt);
				const mapOut = mapResults[`desktop-${repoName}-${run}`] as Record<string, unknown>;
				mapOut.hostLog = readFileSync(metricsLog, 'utf8')
					.trim()
					.split('\n')
					.map((line) => JSON.parse(line) as Record<string, unknown>)
					.filter((entry) => entry.type === 'loadCommits');
				writeFileSync(RESULTS, JSON.stringify(mapResults, null, '\t'));
			} finally {
				await app.close();
			}
		});
	}

for (const repoName of LIST_PERF_REPOS)
	test(`extension in VS Code ${repoName}`, async () => {
		const PERF_REPO = perfRepo(repoName);
		// The E2E suite's folder, on purpose: VS Code puts its IPC socket inside the user-data folder, and a
		// longer path runs past macOS's ~104-character socket limit — VS Code then exits without a window.
		const userData = path.join(STATE_DIR, 'user-data');
		rmSync(userData, { recursive: true, force: true });
		mkdirSync(path.join(userData, 'User'), { recursive: true });
		writeFileSync(
			path.join(userData, 'User', 'settings.json'),
			JSON.stringify(SETTINGS, null, '\t')
		);
		const app = await electron.launch({
			executablePath: await vscodeExecutable(),
			args: [
				PERF_REPO,
				`--extensionDevelopmentPath=${EXTENSION_ROOT}`,
				`--user-data-dir=${userData}`,
				`--extensions-dir=${path.join(STATE_DIR, 'extensions')}`,
				'--disable-workspace-trust',
				'--force-disable-user-env',
				'--skip-welcome',
				'--skip-release-notes',
				'--disable-telemetry',
				'--disable-updates',
				'--disable-crash-reporter',
				'--new-window',
			],
			env: launchEnv(path.join(STATE_DIR, 'perf-agent.txt')),
		});
		try {
			const page = await app.firstWindow();
			await page.waitForSelector('.monaco-workbench', { timeout: 60_000 });
			// VS Code's own Git extension scans the repository on open; let the window go quiet first.
			await settle(15_000);
			const graph = page.frameLocator('iframe.webview.ready').first().frameLocator('#active-frame');
			const shell: Shell = { app, page, graph, pid: app.process().pid ?? 0 };
			await walk(`vscode-${repoName}`, shell, () =>
				runCommand(page, 'Git Octopus: Open Git Octopus in Editor Tab')
			);
		} finally {
			await app.close();
		}
	});
