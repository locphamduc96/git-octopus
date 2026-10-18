import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HostToWebview } from '@git-octopus/shared';
import type { HostViewSettings } from '@git-octopus/host/adapters/services/CommitActionService';
import { STATE_VIEW_SETTINGS } from '@git-octopus/host/adapters/services/GitOctopusController';
import type { ViewChannel } from '@git-octopus/host/app/ports/shell';
import type { ThemeSource } from '../ipc.js';
import { followSavedTheme } from '../themeSource.js';
import { DesktopShell, markdownTitle } from './desktopShell.js';
import { ExternalEditor, type EditorRunner } from './externalEditor.js';

describe('DesktopShell', () => {
	let dir = '';
	let listPosted: HostToWebview[] = [];
	let shell: DesktopShell;
	let primaryView: ViewChannel;
	beforeEach(async () => {
		dir = mkdtempSync(path.join(tmpdir(), 'git-octopus-shell-'));
		listPosted = [];
		shell = new DesktopShell({
			folder: '/repo',
			dataDir: dir,
			logDir: path.join(dir, 'logs'),
			theme: 'dark',
			rpc: () => Promise.resolve(undefined),
		});
		primaryView = {
			postMessage: (message: HostToWebview) => listPosted.push(message),
			onDidReceiveMessage: () => undefined,
		};
		await shell.prepareView(primaryView);
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('shows a notice in the view, and waits only when it offers a choice', async () => {
		await expect(shell.notify.info('Git Octopus: fetched.')).resolves.toBeUndefined();
		const answer = shell.notify.error('Git Octopus: stale lock.', 'Remove stale lock');
		const asked = listPosted.at(-1) as Extract<HostToWebview, { type: 'hostNotice' }>;
		expect(asked).toMatchObject({ level: 'error', listActions: ['Remove stale lock'] });
		shell.receiveViewReply({ type: 'hostNoticeReply', id: asked.id, action: 'Remove stale lock' });
		await expect(answer).resolves.toBe('Remove stale lock');
	});

	it('draws a task from start to end, and passes a cancel on to it', async () => {
		let cancelled = false;
		const result = shell.progress.run(
			'Git Octopus: explaining',
			async (progress) => {
				progress.onCancel(() => (cancelled = true));
				progress.report('commit abc');
				const started = listPosted[0] as Extract<HostToWebview, { type: 'hostProgress' }>;
				shell.receiveViewReply({ type: 'hostProgressCancel', id: started.id });
				return progress.cancelled;
			},
			{ cancellable: true }
		);
		await expect(result).resolves.toBe(true);
		expect(cancelled).toBe(true);
		expect(
			listPosted.map((message) => (message as { done?: boolean; message?: string }).done)
		).toEqual([false, false, true]);
		expect((listPosted[1] as { message?: string }).message).toBe('commit abc');
	});

	describe('openTerminal', () => {
		let listRuns: string[][] = [];
		let listFailing: string[] = [];
		let terminalApp: string | undefined;
		let terminalShell: DesktopShell;
		beforeEach(() => {
			listRuns = [];
			listFailing = [];
			terminalApp = undefined;
			terminalShell = new DesktopShell({
				folder: '/repo',
				dataDir: dir,
				logDir: path.join(dir, 'logs'),
				theme: 'dark',
				rpc: () => Promise.resolve(undefined),
				readViewSettings: () => (terminalApp === undefined ? null : { terminalApp }),
				runOpen: (listArgs) => {
					listRuns.push(listArgs);
					return listFailing.some((marker) => listArgs.join(' ').includes(marker))
						? Promise.reject(new Error('open failed'))
						: Promise.resolve();
				},
			});
		});
		const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

		it.each([
			['Terminal', ['-a', 'Terminal', '/my repo']],
			['iTerm', ['-a', 'iTerm', '/my repo']],
			['Ghostty', ['-na', 'Ghostty', '--args', '--working-directory=/my repo']],
			['Warp', ['warp://action/new_window?path=%2Fmy%20repo']],
		])('opens %s at the folder', async (app, expected) => {
			terminalApp = app;
			terminalShell.open.openTerminal('/my repo');
			await settle();
			expect(listRuns).toEqual([expected]);
		});

		it('opens Terminal when nothing is chosen or the value is unknown', async () => {
			terminalShell.open.openTerminal('/r');
			terminalApp = 'kitty';
			terminalShell.open.openTerminal('/r');
			terminalApp = 'constructor';
			terminalShell.open.openTerminal('/r');
			await settle();
			expect(listRuns).toEqual([
				['-a', 'Terminal', '/r'],
				['-a', 'Terminal', '/r'],
				['-a', 'Terminal', '/r'],
			]);
		});

		it('says so and opens Terminal when the chosen app cannot be launched', async () => {
			terminalApp = 'Ghostty';
			listFailing = ['Ghostty'];
			terminalShell.open.openTerminal('/r');
			await settle();
			expect(listRuns).toEqual([
				['-na', 'Ghostty', '--args', '--working-directory=/r'],
				['-a', 'Terminal', '/r'],
			]);
			const notice = readFileSync(path.join(dir, 'logs', 'host.log'), 'utf8');
			expect(notice).toContain(
				'[warning] Git Octopus: could not open Ghostty, opened Terminal instead.'
			);
		});
	});

	describe('opening files in the editor the user chose', () => {
		interface Call {
			command: string;
			listArgs: string[];
		}
		let listLaunched: Call[] = [];
		let listFailing: string[] = [];
		let settings: HostViewSettings | null = null;
		let editorShell: DesktopShell;
		const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

		beforeEach(async () => {
			listLaunched = [];
			listFailing = [];
			settings = null;
			const runner: EditorRunner = {
				capture: (_command, listArgs) =>
					Promise.resolve(
						listArgs[0].includes('com.microsoft.VSCode') ? '/Applications/VS.app\n' : ''
					),
				launch: (command, listArgs) => {
					listLaunched.push({ command, listArgs });
					return listFailing.includes(command)
						? Promise.reject(new Error(`${command} exited with 1`))
						: Promise.resolve();
				},
			};
			editorShell = new DesktopShell({
				folder: '/repo',
				dataDir: dir,
				logDir: path.join(dir, 'logs'),
				theme: 'dark',
				rpc: () => Promise.resolve(undefined),
				readViewSettings: () => settings,
				externalEditor: new ExternalEditor(runner, { exists: () => true }),
			});
			await editorShell.prepareView({
				postMessage: (message: HostToWebview) => listPosted.push(message),
				onDidReceiveMessage: () => undefined,
			});
		});

		it('opens a conflicted file in the installed editor when nothing is chosen', async () => {
			await editorShell.open.openMergeEditor('/repo/src/a.ts');
			expect(listLaunched).toEqual([
				{ command: 'open', listArgs: ['-b', 'com.microsoft.VSCode', '/repo/src/a.ts'] },
			]);
		});

		it('opens a file of the working tree the same way', async () => {
			await editorShell.editorDiff.openFile('src/a.ts', '/repo');
			expect(listLaunched).toEqual([
				{ command: 'open', listArgs: ['-b', 'com.microsoft.VSCode', '/repo/src/a.ts'] },
			]);
		});

		it('runs the command the user typed, with the file in it', async () => {
			settings = { externalEditor: 'custom', externalEditorCommand: 'subl --wait {file}' };
			await editorShell.open.openMergeEditor('/repo/my file.ts');
			expect(listLaunched).toEqual([{ command: 'subl', listArgs: ['--wait', '/repo/my file.ts'] }]);
		});

		it('falls back to the installed editor when "custom" has no command', async () => {
			settings = { externalEditor: 'custom', externalEditorCommand: '  ' };
			await editorShell.open.openMergeEditor('/repo/a.ts');
			expect(listLaunched[0].listArgs.slice(0, 2)).toEqual(['-b', 'com.microsoft.VSCode']);
		});

		it('opens with macOS when the chosen editor is not installed', async () => {
			settings = { externalEditor: 'zed' };
			await editorShell.open.openMergeEditor('/repo/a.ts');
			expect(listLaunched).toEqual([{ command: 'open', listArgs: ['/repo/a.ts'] }]);
		});

		it('says so in the view when the file cannot be opened at all', async () => {
			listFailing = ['open'];
			await editorShell.open.openMergeEditor('/repo/a.ts');
			await settle();
			const notice = listPosted.at(-1) as Extract<HostToWebview, { type: 'hostNotice' }>;
			expect(notice).toMatchObject({ type: 'hostNotice', level: 'error' });
			expect(notice.message).toContain('could not open /repo/a.ts');
		});
	});

	describe('Markdown', () => {
		it('is shown by the view, titled by its first heading', async () => {
			await shell.open.showMarkdown('# Commit abc\n\n_Explained by Claude._\n\nBody\n');
			expect(listPosted.at(-1)).toEqual({
				type: 'showMarkdown',
				title: 'Commit abc',
				content: '# Commit abc\n\n_Explained by Claude._\n\nBody\n',
			});
		});

		it('waits for a view when none is attached, and is handed over once one listens', async () => {
			shell.forgetView(primaryView);
			await shell.open.showMarkdown('# Late\n');
			const listLate: HostToWebview[] = [];
			shell.deliverPending({
				postMessage: (message: HostToWebview) => listLate.push(message),
				onDidReceiveMessage: () => undefined,
			});
			expect(listLate).toEqual([{ type: 'showMarkdown', title: 'Late', content: '# Late\n' }]);
			const listAgain: HostToWebview[] = [];
			shell.deliverPending({
				postMessage: (message: HostToWebview) => listAgain.push(message),
				onDidReceiveMessage: () => undefined,
			});
			expect(listAgain).toEqual([]);
		});

		it('is titled by its first heading, wherever it stands, else plainly', () => {
			expect(markdownTitle('no heading here')).toBe('Explanation');
			expect(markdownTitle('intro\n## Branch develop — 2 commits ##\n')).toBe(
				'Branch develop — 2 commits'
			);
		});
	});

	describe('what the view says to the window', () => {
		let listRpc: unknown[][] = [];
		let saveAnswer: unknown;
		let windowShell: DesktopShell;
		const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

		beforeEach(async () => {
			listRpc = [];
			saveAnswer = undefined;
			windowShell = new DesktopShell({
				folder: '/repo',
				dataDir: dir,
				logDir: path.join(dir, 'logs'),
				theme: 'dark',
				rpc: (method, ...args) => {
					listRpc.push([method, ...args]);
					return Promise.resolve(method === 'saveFile' ? saveAnswer : undefined);
				},
			});
			await windowShell.prepareView({
				postMessage: (message: HostToWebview) => listPosted.push(message),
				onDidReceiveMessage: () => undefined,
			});
		});

		it('opens a link only when it is https', async () => {
			windowShell.receiveDesktopMessage({ type: 'openLink', url: 'https://example.com/a' });
			windowShell.receiveDesktopMessage({ type: 'openLink', url: 'http://example.com/a' });
			windowShell.receiveDesktopMessage({ type: 'openLink', url: 'javascript:alert(1)' });
			windowShell.receiveDesktopMessage({ type: 'openLink', url: 'file:///etc/passwd' });
			windowShell.receiveDesktopMessage({ type: 'openLink', url: 'not a url' });
			await settle();
			expect(listRpc).toEqual([['openExternal', 'https://example.com/a']]);
		});

		it('saves the Markdown where main puts it, and says where', async () => {
			saveAnswer = '/Users/me/Documents/commit-abc.md';
			windowShell.receiveDesktopMessage({
				type: 'saveMarkdown',
				content: '# Commit abc\n',
				suggestedName: 'commit-abc.md',
			});
			await settle();
			expect(listRpc).toEqual([['saveFile', 'commit-abc.md', '# Commit abc\n']]);
			expect(listPosted.at(-1)).toMatchObject({
				type: 'hostNotice',
				message: 'Git Octopus: saved /Users/me/Documents/commit-abc.md.',
			});
		});

		it('says nothing when the save dialog was cancelled', async () => {
			const before = listPosted.length;
			windowShell.receiveDesktopMessage({
				type: 'saveMarkdown',
				content: 'x',
				suggestedName: 'x.md',
			});
			await settle();
			expect(listPosted).toHaveLength(before);
		});

		it('answers the credential question the view was asked', async () => {
			const answer = windowShell.credentialPrompt.ask(
				{ title: 'Git Octopus: push — r → h', prompt: 'Password for h:', secret: true },
				new AbortController().signal
			);
			const asked = listPosted.at(-1) as Extract<HostToWebview, { type: 'credentialRequest' }>;
			windowShell.receiveDesktopMessage({ type: 'credentialReply', id: asked.id, answer: 'pw' });
			await expect(answer).resolves.toBe('pw');
		});

		it('puts an unanswered credential question to a view that begins listening later', () => {
			void windowShell.credentialPrompt.ask(
				{ title: 'Git Octopus: push — r → h', prompt: 'Password for h:', secret: true },
				new AbortController().signal
			);
			const listLate: HostToWebview[] = [];
			windowShell.deliverPending({
				postMessage: (message: HostToWebview) => listLate.push(message),
				onDidReceiveMessage: () => undefined,
			});
			expect(listLate.map((message) => message.type)).toEqual(['credentialRequest']);
		});
	});

	it('tells its owner when the view settings are saved, and for nothing else', async () => {
		const listHeard: (HostViewSettings | null)[] = [];
		const watched = new DesktopShell({
			folder: '/repo',
			dataDir: dir,
			logDir: path.join(dir, 'logs'),
			theme: 'dark',
			rpc: () => Promise.resolve(undefined),
			onViewSettingsSaved: (settings) => listHeard.push(settings),
		});
		await watched.globalState.update('something.else', { settings: { theme: 'light' } });
		await watched.globalState.update(STATE_VIEW_SETTINGS, {
			settings: { theme: 'dark', gitPath: '/opt/git' },
			columns: {},
		});
		expect(listHeard).toEqual([{ theme: 'dark', gitPath: '/opt/git' }]);
	});

	it('applies a theme choice in one tab even when another tab changed the theme in between', async () => {
		const listApplied: [string, ThemeSource][] = [];
		const openTab = (name: string) =>
			new DesktopShell({
				folder: '/repo',
				dataDir: dir,
				logDir: path.join(dir, 'logs'),
				theme: 'dark',
				rpc: () => Promise.resolve(undefined),
				onViewSettingsSaved: (settings) =>
					followSavedTheme(settings, (source) => listApplied.push([name, source])),
			});
		const tabA = openTab('A');
		const tabB = openTab('B');
		await tabA.globalState.update(STATE_VIEW_SETTINGS, {
			settings: { theme: 'dark' },
			columns: {},
		});
		await tabB.globalState.update(STATE_VIEW_SETTINGS, {
			settings: { theme: 'system' },
			columns: {},
		});
		expect(listApplied).toEqual([
			['A', 'dark'],
			['B', 'system'],
		]);
	});

	it('looks for repositories in its own folder, and keeps its state there', async () => {
		expect(shell.listRoots()).toEqual(['/repo']);
		await shell.workspaceState.update('gitOctopus.activeRepo', '/repo');
		expect(shell.workspaceState.get('gitOctopus.activeRepo')).toBe('/repo');
		expect(shell.colorThemeKind()).toBe('dark');
		shell.setTheme('light');
		expect(shell.colorThemeKind()).toBe('light');
	});
});
