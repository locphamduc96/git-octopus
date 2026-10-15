import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

const listSent: { type: string; [key: string]: unknown }[] = [];
vi.stubGlobal('acquireVsCodeApi', () => ({
	postMessage: (message: { type: string }) => listSent.push(message),
	getState: () => undefined,
	setState: () => undefined,
}));

const { dispatchHostMessage } = await import('../../lib/hostRouter');
const { worktrees } = await import('../../lib/stores/worktrees.svelte');
const { default: WorktreesSection } = await import('./WorktreesSection.svelte');

const worktree = (over: Record<string, unknown>) => ({
	path: '/code/app',
	head: '1'.repeat(40),
	branch: 'main',
	isMain: false,
	isCurrent: false,
	locked: false,
	prunable: false,
	...over,
});

async function show(): Promise<void> {
	render(WorktreesSection);
	dispatchHostMessage({
		type: 'worktrees',
		listWorktrees: [
			worktree({ isMain: true, isCurrent: true }),
			worktree({ path: '/code/app-feature', branch: 'feature' }),
			worktree({ path: '/code/gone', branch: null, prunable: true }),
		],
	});
	await screen.findByText('/code/app-feature');
}

describe('WorktreesSection', () => {
	it('lists every worktree, with remove and open only where they make sense', async () => {
		await show();
		expect(screen.getByText('this window')).toBeTruthy();
		expect(screen.getByText('folder missing')).toBeTruthy();
		expect(screen.queryByLabelText('Remove the worktree at /code/app')).toBeNull();
		expect(screen.queryByLabelText('Open /code/app in a new window')).toBeNull();
		expect(screen.queryByLabelText('Open /code/gone in a new window')).toBeNull();
		listSent.length = 0;
		await fireEvent.click(screen.getByLabelText('Open /code/app-feature in a new window'));
		expect(listSent.at(-1)).toMatchObject({
			type: 'worktreeAction',
			action: 'open',
			path: '/code/app-feature',
		});
	});

	it('offers prune when a folder is gone, and adds with or without a folder', async () => {
		await show();
		listSent.length = 0;
		await fireEvent.click(screen.getByText('Prune'));
		expect(listSent.at(-1)).toMatchObject({ type: 'worktreeAction', action: 'prune' });
		dispatchHostMessage({
			type: 'worktrees',
			listWorktrees: [worktree({ isMain: true, isCurrent: true })],
		});
		await fireEvent.input(screen.getByLabelText('Worktree branch'), {
			target: { value: 'hotfix' },
		});
		await fireEvent.click(screen.getByText('Add'));
		expect(listSent.at(-1)).toEqual({
			type: 'worktreeAction',
			repoPath: '',
			action: 'add',
			branch: 'hotfix',
		});
	});

	it('names the branches other worktrees hold, for the branch menus', async () => {
		await show();
		expect(worktrees.mapElsewhere).toEqual({ feature: '/code/app-feature' });
	});
});
