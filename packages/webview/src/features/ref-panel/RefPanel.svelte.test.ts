import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import RefPanelHarness from './RefPanel.harness.svelte';
import type { RefPanelData } from './refPanelModel';

const hash = (digit: string): string => digit.repeat(40);

const data: RefPanelData = {
	listLocal: [
		{ name: 'main', hash: hash('1') },
		{ name: 'feature/a', hash: hash('2') },
		{ name: 'feature/b', hash: hash('3') },
	],
	listRemote: [
		{ name: 'origin/main', hash: hash('1'), remote: 'origin' },
		{ name: 'origin/feature/a', hash: hash('2'), remote: 'origin' },
	],
	listTags: [{ name: 'v1.0', hash: hash('1') }],
	listStashes: [{ selector: 'stash@{0}', hash: hash('4'), message: 'WIP on main' }],
	current: 'main',
};

const listWorktrees = [
	{
		path: '/code/app',
		head: hash('1'),
		branch: 'main',
		isMain: true,
		isCurrent: true,
		locked: false,
		prunable: false,
	},
];

const listSubmodules = [
	{ path: '/code/app/vendor/lib', name: 'lib', parent: '/code/app', subPath: 'vendor/lib' },
];

function mount(
	over: { listInitialCollapsed?: string[]; hidden?: Partial<{ listBranches: string[] }> } = {}
) {
	const handlers = {
		onchange: vi.fn(),
		onselect: vi.fn(),
		onactivate: vi.fn(),
		oncontextmenu: vi.fn(),
		ondragstart: vi.fn(),
		ontogglehidden: vi.fn(),
	};
	render(RefPanelHarness, {
		data,
		listWorktrees,
		listSubmodules,
		hidden: { listBranches: [], listRemotes: [], listTags: [], ...over.hidden },
		listInitialCollapsed: over.listInitialCollapsed,
		...handlers,
	});
	return handlers;
}

const row = (name: string) => screen.getByRole('treeitem', { name });

describe('RefPanel', () => {
	it('shows every section with its count, and the folders of a branch name', () => {
		mount();
		expect(row('Local (3)')).toBeTruthy();
		expect(row('Remote (2)')).toBeTruthy();
		expect(row('Tags (1)')).toBeTruthy();
		expect(row('Stashes (1)')).toBeTruthy();
		expect(row('Worktrees (1)')).toBeTruthy();
		expect(row('Submodules (1)')).toBeTruthy();
		expect(row('feature (2)')).toBeTruthy();
		expect(row('feature/a')).toBeTruthy();
		expect(row('origin (2)')).toBeTruthy();
	});

	it('collapses and expands a section and a folder, and reports the new list', async () => {
		const handlers = mount();
		await fireEvent.click(row('feature (2)'));
		expect(screen.queryByRole('treeitem', { name: 'feature/a' })).toBeNull();
		expect(row('feature (2)').getAttribute('aria-expanded')).toBe('false');
		expect(handlers.onchange).toHaveBeenLastCalledWith(['local:folder:feature']);

		await fireEvent.click(row('Local (3)'));
		expect(screen.queryByRole('treeitem', { name: 'main' })).toBeNull();
		expect(handlers.onchange).toHaveBeenLastCalledWith(['local:folder:feature', 'local']);

		await fireEvent.click(row('Local (3)'));
		await fireEvent.click(row('feature (2)'));
		expect(row('feature/a')).toBeTruthy();
		expect(handlers.onchange).toHaveBeenLastCalledWith([]);
		expect(handlers.onselect).not.toHaveBeenCalled();
	});

	it('starts with the sections and folders it was told are collapsed', () => {
		mount({ listInitialCollapsed: ['tags', 'local:folder:feature'] });
		expect(screen.queryByRole('treeitem', { name: 'v1.0' })).toBeNull();
		expect(screen.queryByRole('treeitem', { name: 'feature/a' })).toBeNull();
		expect(row('main')).toBeTruthy();
	});

	it('moves focus with the arrow keys and selects with Enter', async () => {
		const handlers = mount();
		const local = row('Local (3)');
		local.focus();
		await fireEvent.keyDown(local, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(row('feature (2)'));
		await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(row('feature/a'));
		await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
		expect(document.activeElement).toBe(row('feature (2)'));
		await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
		await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
		await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
		expect(handlers.onselect).toHaveBeenCalledTimes(1);
		expect(handlers.onselect.mock.calls[0][0]).toMatchObject({
			kind: 'local',
			name: 'feature/b',
			hash: hash('3'),
		});
	});

	it('toggles a folder with Enter and the left and right arrows', async () => {
		mount();
		const folder = row('feature (2)');
		folder.focus();
		await fireEvent.keyDown(folder, { key: 'ArrowLeft' });
		expect(screen.queryByRole('treeitem', { name: 'feature/a' })).toBeNull();
		await fireEvent.keyDown(folder, { key: 'ArrowRight' });
		expect(row('feature/a')).toBeTruthy();
		await fireEvent.keyDown(folder, { key: 'Enter' });
		expect(screen.queryByRole('treeitem', { name: 'feature/a' })).toBeNull();
	});

	it('reports a click, a double-click and a right-click with the ref they landed on', async () => {
		const handlers = mount();
		await fireEvent.click(row('origin/feature/a'));
		expect(handlers.onselect.mock.calls[0][0]).toMatchObject({
			kind: 'remote',
			name: 'origin/feature/a',
			remote: 'origin',
			hash: hash('2'),
		});
		await fireEvent.doubleClick(row('feature/b'));
		expect(handlers.onactivate.mock.calls[0][0]).toMatchObject({
			kind: 'local',
			name: 'feature/b',
		});
		await fireEvent.contextMenu(row('v1.0'));
		expect(handlers.oncontextmenu.mock.calls[0][0]).toMatchObject({
			kind: 'tag',
			name: 'v1.0',
			hash: hash('1'),
		});
		expect(handlers.oncontextmenu.mock.calls[0][1]).toBeInstanceOf(MouseEvent);
		await fireEvent.click(row('stash@{0} — WIP on main'));
		expect(handlers.onselect.mock.calls[1][0]).toMatchObject({
			kind: 'stash',
			name: 'stash@{0}',
			hash: hash('4'),
			detail: 'WIP on main',
		});
		await fireEvent.click(row('/code/app — main'));
		expect(handlers.onselect.mock.calls[2][0]).toMatchObject({
			kind: 'worktree',
			name: '/code/app',
		});
		await fireEvent.click(row('/code/app/vendor/lib — vendor/lib'));
		expect(handlers.onselect.mock.calls[3][0]).toMatchObject({
			kind: 'submodule',
			name: '/code/app/vendor/lib',
			hash: null,
		});
	});

	it('starts a drag from a ref row and not from a stash', async () => {
		const handlers = mount();
		const branch = row('feature/a');
		expect(branch.getAttribute('draggable')).toBe('true');
		await fireEvent.dragStart(branch);
		expect(handlers.ondragstart.mock.calls[0][0]).toMatchObject({
			kind: 'local',
			name: 'feature/a',
		});
		expect(row('stash@{0} — WIP on main').getAttribute('draggable')).toBe('false');
	});

	it('marks the checked-out branch and the hidden refs', async () => {
		const handlers = mount({ hidden: { listBranches: ['feature/b'] } });
		expect(row('main').getAttribute('aria-current')).toBe('true');
		expect(row('feature/a').getAttribute('aria-current')).toBeNull();
		expect(row('feature/b').classList.contains('hidden')).toBe(true);
		expect(row('feature/a').classList.contains('hidden')).toBe(false);

		await fireEvent.click(screen.getByLabelText('Show feature/b in the graph'));
		expect(handlers.ontogglehidden.mock.calls[0][0]).toMatchObject({
			name: 'feature/b',
			hidden: true,
		});
		await fireEvent.click(screen.getByLabelText('Hide feature/a from the graph'));
		expect(handlers.ontogglehidden.mock.calls[1][0]).toMatchObject({
			name: 'feature/a',
			hidden: false,
		});
		expect(handlers.onselect).not.toHaveBeenCalled();
	});

	it('does not activate the row when the visibility button is double-clicked', async () => {
		const handlers = mount();
		const button = screen.getByLabelText('Hide feature/a from the graph');
		await fireEvent.click(button);
		await fireEvent.click(button);
		await fireEvent.doubleClick(button);
		expect(handlers.ontogglehidden).toHaveBeenCalledTimes(2);
		expect(handlers.onactivate).not.toHaveBeenCalled();
		expect(handlers.onselect).not.toHaveBeenCalled();
	});

	it('keeps the keys it handles from reaching the window', async () => {
		mount();
		const listSeenKeys: string[] = [];
		const listener = (event: KeyboardEvent): void => {
			listSeenKeys.push(event.key);
		};
		window.addEventListener('keydown', listener);
		try {
			const local = row('Local (3)');
			local.focus();
			await fireEvent.keyDown(local, { key: 'ArrowDown' });
			await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
			await fireEvent.keyDown(screen.getByLabelText('Filter refs'), { key: 'ArrowDown' });
			await fireEvent.input(screen.getByLabelText('Filter refs'), { target: { value: 'x' } });
			await fireEvent.keyDown(screen.getByLabelText('Filter refs'), { key: 'Escape' });
			expect(listSeenKeys).toEqual([]);
			await fireEvent.keyDown(row('Local (3)'), { key: 'Tab' });
			expect(listSeenKeys).toEqual(['Tab']);
		} finally {
			window.removeEventListener('keydown', listener);
		}
	});

	it('narrows the rows to what the filter matches, opening folded folders', async () => {
		mount({ listInitialCollapsed: ['local:folder:feature'] });
		await fireEvent.input(screen.getByLabelText('Filter refs'), {
			target: { value: 'FEATURE/A' },
		});
		expect(row('Local (1)')).toBeTruthy();
		expect(row('Remote (1)')).toBeTruthy();
		expect(screen.getAllByRole('treeitem', { name: /feature\/a$/ })).toHaveLength(2);
		expect(screen.queryByRole('treeitem', { name: 'feature/b' })).toBeNull();
		expect(screen.queryByRole('treeitem', { name: 'main' })).toBeNull();
		expect(screen.queryByRole('treeitem', { name: /^Tags/ })).toBeNull();

		await fireEvent.input(screen.getByLabelText('Filter refs'), { target: { value: 'nothing' } });
		expect(screen.getByText('No refs match the filter')).toBeTruthy();

		await fireEvent.keyDown(screen.getByLabelText('Filter refs'), { key: 'Escape' });
		expect((screen.getByLabelText('Filter refs') as HTMLInputElement).value).toBe('');
		expect(row('Local (3)')).toBeTruthy();
	});
});
