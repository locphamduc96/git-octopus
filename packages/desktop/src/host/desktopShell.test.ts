import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HostToWebview } from '@git-octopus/shared';
import { DesktopShell } from './desktopShell.js';

describe('DesktopShell', () => {
	let dir = '';
	let listPosted: HostToWebview[] = [];
	let shell: DesktopShell;
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
		await shell.prepareView({
			postMessage: (message: HostToWebview) => listPosted.push(message),
			onDidReceiveMessage: () => undefined,
		});
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
			await settle();
			expect(listRuns).toEqual([
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

	it('looks for repositories in its own folder, and keeps its state there', async () => {
		expect(shell.listRoots()).toEqual(['/repo']);
		await shell.workspaceState.update('gitOctopus.activeRepo', '/repo');
		expect(shell.workspaceState.get('gitOctopus.activeRepo')).toBe('/repo');
		expect(shell.colorThemeKind()).toBe('dark');
		shell.setTheme('light');
		expect(shell.colorThemeKind()).toBe('light');
	});
});
