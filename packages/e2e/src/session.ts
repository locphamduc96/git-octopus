import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	_electron as electron,
	test,
	type ElectronApplication,
	type FrameLocator,
	type Page,
} from '@playwright/test';
import { EXTENSION_ROOT, FAKE_BIN, FIXTURE_SCRIPT, STATE_DIR } from './paths.js';
import { vscodeExecutable } from './vscodeBinary.js';

/** Settings that keep VS Code's own furniture out of the way and make every dialog a DOM one. */
export const SETTINGS = {
	'window.dialogStyle': 'custom',
	'window.restoreWindows': 'none',
	'window.newWindowDimensions': 'maximized',
	'window.commandCenter': false,
	'workbench.startupEditor': 'none',
	'workbench.secondarySideBar.defaultVisibility': 'hidden',
	'workbench.tips.enabled': false,
	'workbench.enableExperiments': false,
	'security.workspace.trust.enabled': false,
	'extensions.ignoreRecommendations': true,
	'update.mode': 'none',
	'telemetry.telemetryLevel': 'off',
	'git.openRepositoryInParentFolders': 'never',
	'gitOctopus.defaultLocation': 'editor',
	// One step smaller, so a laptop screen (1512 points wide) has room for every optional column
	// beside the details panel — the width the drag and compare tests need, on any display.
	'window.zoomLevel': -1,
};

export interface Session {
	app: ElectronApplication;
	page: Page;
	/** The graph's webview: VS Code wraps it in two iframes. */
	graph: FrameLocator;
	/** The repository under test (`<root>/review` from the fixture). */
	repo: string;
	root: string;
	/** Where the fake agent CLI writes the last prompt it was handed. */
	agentLog: string;
	/** Run git in the repository and return its stdout. */
	git: (...listArgs: string[]) => string;
	close: () => Promise<void>;
}

/**
 * A fresh copy of the review repository, opened in the pinned VS Code with the extension loaded from
 * source, and the graph open in an editor tab. `close` tears both down, the temporary repository
 * included, whatever state the tests left them in.
 */
export interface SessionOptions {
	/**
	 * Shape the fresh repository before VS Code opens it (run git through the helper). `root` is the
	 * session's temporary folder — anything written there is deleted with it.
	 */
	prepare?: (git: (...listArgs: string[]) => string, root: string) => void;
	/**
	 * Point git — the fixture, the helper and VS Code alike — at an empty global config in the
	 * session folder, so the developer's own `~/.gitconfig` cannot change the outcome. Signing needs
	 * it: one bad `gpg.format` there is fatal to every signature git reads.
	 */
	isolateGlobalConfig?: boolean;
}

export async function openSession(options: SessionOptions = {}): Promise<Session> {
	const root = mkdtempSync(path.join(os.tmpdir(), 'git-octopus-e2e-'));
	let app: ElectronApplication | null = null;
	const close = async (): Promise<void> => {
		try {
			await app?.close();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	};
	try {
		const mapGitEnv: Record<string, string> = {};
		if (options.isolateGlobalConfig) {
			mapGitEnv.GIT_CONFIG_GLOBAL = path.join(root, 'global.gitconfig');
			writeFileSync(mapGitEnv.GIT_CONFIG_GLOBAL, '');
		}
		const gitEnv = { ...process.env, ...mapGitEnv };
		execFileSync('sh', [FIXTURE_SCRIPT, root], { stdio: 'pipe', env: gitEnv });
		const repo = path.join(root, 'review');
		const agentLog = path.join(root, 'agent-prompt.txt');
		const git = (...listArgs: string[]): string =>
			execFileSync('git', ['-C', repo, ...listArgs], { encoding: 'utf8', env: gitEnv });
		options.prepare?.(git, root);
		const userData = path.join(STATE_DIR, 'user-data');
		rmSync(userData, { recursive: true, force: true });
		mkdirSync(path.join(userData, 'User'), { recursive: true });
		writeFileSync(
			path.join(userData, 'User', 'settings.json'),
			JSON.stringify(SETTINGS, null, '\t')
		);

		const executablePath = process.env.GIT_OCTOPUS_E2E_VSCODE ?? (await vscodeExecutable());
		app = await electron.launch({
			executablePath,
			args: [
				repo,
				`--extensionDevelopmentPath=${EXTENSION_ROOT}`,
				`--user-data-dir=${userData}`,
				// Empty: only the extension under test and VS Code's built-ins (git, merge editor) load.
				`--extensions-dir=${path.join(STATE_DIR, 'extensions')}`,
				'--disable-workspace-trust',
				// Keep the PATH given here: otherwise VS Code re-reads the login shell's and the fake
				// agent CLI drops off it.
				'--force-disable-user-env',
				'--skip-welcome',
				'--skip-release-notes',
				'--disable-telemetry',
				'--disable-updates',
				'--disable-crash-reporter',
				'--no-cached-data',
				'--new-window',
			],
			env: { ...launchEnv(agentLog), ...mapGitEnv },
		});
		const page = await app.firstWindow();
		await page.waitForSelector('.monaco-workbench', { timeout: 60_000 });
		await runCommand(page, 'Git Octopus: Open Git Octopus in Editor Tab');
		const graph = page.frameLocator('iframe.webview.ready').first().frameLocator('#active-frame');
		await graph.locator('button.ref').first().waitFor({ timeout: 60_000 });
		return { app, page, graph, repo, root, agentLog, git, close };
	} catch (err) {
		await close();
		throw err;
	}
}

/**
 * The environment VS Code starts with. Run from inside an editor (a VS Code terminal, an agent in
 * one), the parent's `ELECTRON_RUN_AS_NODE` would start VS Code as plain Node and its `VSCODE_*`
 * variables would hand the launch to the editor already running — both are dropped. The fake agent
 * CLI goes first on PATH, so AI features answer without an account.
 */
export function launchEnv(agentLog: string): Record<string, string> {
	const mapEnv: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined || key.startsWith('VSCODE_') || key.startsWith('ELECTRON_')) continue;
		mapEnv[key] = value;
	}
	mapEnv.PATH = `${FAKE_BIN}${path.delimiter}${mapEnv.PATH ?? ''}`;
	mapEnv.GIT_OCTOPUS_FAKE_AGENT_LOG = agentLog;
	return mapEnv;
}

/**
 * One session per spec file, run in order like a checklist phase: opened before the first test,
 * closed after the last, and a picture of the window attached to every test's report.
 */
export function useSession(assign: (session: Session) => void, options: SessionOptions = {}): void {
	let session: Session | undefined;
	test.describe.configure({ mode: 'serial' });
	test.beforeAll(async () => {
		session = await openSession(options);
		assign(session);
	});
	test.afterEach(async ({}, testInfo) => {
		if (!session) return;
		await testInfo.attach('vscode.png', {
			body: await session.page.screenshot(),
			contentType: 'image/png',
		});
	});
	test.afterAll(async () => {
		await session?.close();
	});
}

/** Run a command from the palette by its full title. */
export async function runCommand(page: Page, title: string): Promise<void> {
	await page.keyboard.press('F1');
	const input = page.locator('.quick-input-widget input');
	await input.waitFor();
	await input.fill(`>${title}`);
	// Clicked by its exact label: Enter takes the top row, and "Close Editor" ranks "Close Editor
	// Group" first.
	const exactTitle = new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
	await page
		.locator('.quick-input-list .monaco-list-row')
		.filter({ has: page.locator('.label-name', { hasText: exactTitle }) })
		.first()
		.click();
}
