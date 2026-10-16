import { beforeEach, describe, expect, it } from 'vitest';
import {
	ConfigurationTarget,
	mapConfig,
	mapConfigTarget,
	recorded,
	resetRecorded,
	window,
	ColorThemeKind,
} from '../../test/vscodeStub.js';
import { vscodeControllerShell, vscodeHostShell } from './vscodeShell.js';

/** The host's ports as VS Code answers them — what the host's own tests take for granted. */
describe('vscodeShell', () => {
	beforeEach(resetRecorded);

	it('reads and writes settings under gitOctopus, as user settings', async () => {
		mapConfig.set('gitOctopus.aiCommit.language', 'Vietnamese');
		expect(vscodeHostShell.settings.get('aiCommit.language', '')).toBe('Vietnamese');
		expect(vscodeHostShell.settings.get('autoRefresh', true)).toBe(true);
		await vscodeHostShell.settings.update('identities', []);
		// Global, never per-workspace: an account saved into one folder's settings is invisible
		// everywhere else, which reads to the user as the account having been lost.
		expect(mapConfigTarget.get('gitOctopus.identities')).toBe(ConfigurationTarget.Global);
	});

	it('hands each notice level to its own VS Code notification', async () => {
		await vscodeHostShell.notify.info('i');
		await vscodeHostShell.notify.warn('w');
		await vscodeHostShell.notify.error('e');
		expect([recorded.listInfo, recorded.listWarnings, recorded.listErrors]).toEqual([
			['i'],
			['w'],
			['e'],
		]);
	});

	it('runs a task under progress and gives back its result', async () => {
		let reported = false;
		const result = await vscodeHostShell.progress.run('Working', async (progress) => {
			progress.report('half way');
			reported = !progress.cancelled;
			return 42;
		});
		expect(result).toBe(42);
		expect(reported).toBe(true);
	});

	it('opens a worktree in a new window and a conflict in VS Code’s merge editor', async () => {
		await vscodeHostShell.open.openFolderWindow('/r/wt');
		await vscodeHostShell.open.openMergeEditor('/r/src/a.ts');
		expect(recorded.listCommands.map((entry) => entry.command)).toEqual([
			'vscode.openFolder',
			'git.openMergeEditor',
		]);
		expect(recorded.listCommands[0].listArgs[1]).toEqual({ forceNewWindow: true });
	});

	it('opens Markdown beside the graph', async () => {
		await vscodeHostShell.open.showMarkdown('# Title');
		expect(recorded.listDocuments).toEqual([{ language: 'markdown', content: '# Title' }]);
	});

	it('scopes the graph keybindings with a context key, and focuses through the command', async () => {
		const shell = vscodeControllerShell(
			{ extensionUri: { fsPath: '/ext', path: '/ext' } } as never,
			{} as never
		);
		shell.setGraphFocused(true);
		await shell.focusGraph();
		expect(recorded.listCommands).toEqual([
			{ command: 'setContext', listArgs: ['gitOctopus.graphFocused', true] },
			{ command: 'git-octopus.focus', listArgs: [] },
		]);
	});

	it('maps high contrast to its base kind', () => {
		const shell = vscodeControllerShell(
			{ extensionUri: { fsPath: '/ext', path: '/ext' } } as never,
			{} as never
		);
		window.activeColorTheme = { kind: ColorThemeKind.HighContrastLight };
		expect(shell.colorThemeKind()).toBe('light');
		window.activeColorTheme = { kind: ColorThemeKind.HighContrast };
		expect(shell.colorThemeKind()).toBe('dark');
	});
});
