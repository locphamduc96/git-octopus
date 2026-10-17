import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { WorkingTreeStatus } from '@git-octopus/shared';

vi.stubGlobal('acquireVsCodeApi', () => ({
	postMessage: () => {},
	getState: () => undefined,
	setState: () => undefined,
}));

const { dispatchHostMessage } = await import('../../lib/hostRouter');
const { default: ChangesTab } = await import('./ChangesTab.svelte');

const working: WorkingTreeStatus = {
	staged: [{ status: 'M', path: 'src/board.ts' }],
	unstaged: [],
};

function mount() {
	const onaction = vi.fn();
	render(ChangesTab, {
		working,
		ahead: 0,
		fileView: 'list',
		activePath: null,
		onaction,
		onopenFile: vi.fn(),
		onmenu: vi.fn(),
		onpush: vi.fn(),
		onpushForce: vi.fn(),
	});
	return onaction;
}

const summary = () =>
	screen.queryByPlaceholderText('Short description of the change') as HTMLInputElement | null;

async function commitWith(text: string): Promise<void> {
	await fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
	await fireEvent.input(summary() as HTMLInputElement, { target: { value: text } });
	await fireEvent.keyDown(summary() as HTMLInputElement, { key: 'Enter' });
}

describe('ChangesTab commit dialog', () => {
	it('comes back with the message when the host refuses the commit', async () => {
		const onaction = mount();
		await commitWith('test chan-hook');
		expect(onaction).toHaveBeenCalledWith('commit', undefined, 'test chan-hook', {
			noVerify: false,
			pushAfter: false,
		});
		expect(summary()).toBeNull();
		dispatchHostMessage({ type: 'commitOutcome', ok: false });
		expect(
			(await screen.findByPlaceholderText('Short description of the change')) as HTMLInputElement
		).toHaveProperty('value', 'test chan-hook');
	});

	it('drops the draft on Cancel', async () => {
		mount();
		await commitWith('feat: dropped');
		dispatchHostMessage({ type: 'commitOutcome', ok: false });
		await screen.findByPlaceholderText('Short description of the change');
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
		expect(summary()?.value).toBe('');
	});

	it('forgets the draft once the commit lands, and does not reopen', async () => {
		mount();
		await commitWith('feat: landed');
		dispatchHostMessage({ type: 'commitOutcome', ok: true });
		expect(summary()).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
		expect(summary()?.value).toBe('');
	});
});

describe('ChangesTab sections', () => {
	it('lists staged changes first, as Source Control does, with conflicts above all', () => {
		render(ChangesTab, {
			working: {
				staged: [{ status: 'M', path: 'src/staged.ts' }],
				unstaged: [
					{ status: 'M', path: 'src/edited.ts' },
					{ status: '?', path: 'notes/todo.md' },
					{ status: 'U', path: 'src/clash.ts' },
				],
			},
			ahead: 0,
			fileView: 'list',
			activePath: null,
			onaction: vi.fn(),
			onopenFile: vi.fn(),
			onmenu: vi.fn(),
			onpush: vi.fn(),
			onpushForce: vi.fn(),
		});
		const listTitles = screen
			.getAllByRole('heading', { level: 3 })
			.map((heading) => heading.querySelector('.title')?.textContent);
		expect(listTitles).toEqual(['Conflicts', 'Staged Changes', 'Changes', 'Untracked']);
	});
});

describe('ChangesTab folding', () => {
	it('folds a group from its header and opens it again', async () => {
		render(ChangesTab, {
			working: {
				staged: [{ status: 'M', path: 'src/staged.ts' }],
				unstaged: [{ status: 'M', path: 'src/edited.ts' }],
			},
			ahead: 0,
			fileView: 'list',
			activePath: null,
			onaction: vi.fn(),
			onopenFile: vi.fn(),
			onmenu: vi.fn(),
			onpush: vi.fn(),
			onpushForce: vi.fn(),
		});
		const header = screen.getByRole('button', { name: /Staged Changes/ });
		expect(header.getAttribute('aria-expanded')).toBe('true');
		expect(screen.queryByText('staged.ts')).not.toBeNull();

		await fireEvent.click(header);
		expect(header.getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByText('staged.ts')).toBeNull();
		// Only the group that was folded: the next one still lists its file.
		expect(screen.queryByText('edited.ts')).not.toBeNull();

		await fireEvent.click(header);
		expect(screen.queryByText('staged.ts')).not.toBeNull();
	});
});

describe('ChangesTab group headings', () => {
	it('starts each heading with the group name, which is how the end-to-end suite finds it', () => {
		render(ChangesTab, {
			working: { staged: [{ status: 'M', path: 'src/staged.ts' }], unstaged: [] },
			ahead: 0,
			fileView: 'list',
			activePath: null,
			onaction: vi.fn(),
			onopenFile: vi.fn(),
			onmenu: vi.fn(),
			onpush: vi.fn(),
			onpushForce: vi.fn(),
		});
		expect(screen.getByRole('heading', { level: 3 }).textContent).toMatch(/^Staged Changes\b/);
	});
});

describe('ChangesTab toolbar', () => {
	it('groups the working-tree actions and the AI actions on their own islands', () => {
		mount();
		const islandOf = (name: string) => screen.getByRole('button', { name }).closest('.gg-island');
		const listIslands = [...document.querySelectorAll('.toolbar > .gg-island')];
		expect(listIslands).toHaveLength(2);
		for (const name of [
			'Undo last commit',
			'Stash uncommitted changes',
			'Unstage all',
			'Stage all',
		]) {
			expect(islandOf(name)).toBe(listIslands[0]);
		}
		for (const name of ['Explain changes with AI', 'AI commit']) {
			expect(islandOf(name)).toBe(listIslands[1]);
		}
		expect(screen.getByRole('button', { name: 'Commit' }).closest('.gg-island')).toBeNull();
	});
});
