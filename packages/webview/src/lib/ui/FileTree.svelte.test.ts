import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import type { FileChange } from '@git-octopus/shared';
import { buildFileTree } from '../fileTree';
import FileTree from './FileTree.svelte';

// jsdom has no scrollIntoView; FileRow calls it on the active row.
beforeAll(() => {
	Element.prototype.scrollIntoView = () => {};
});

const file = (path: string): FileChange => ({ path, status: 'M' });

const NODES = buildFileTree([
	file('src/app/one.ts'),
	file('src/app/two.ts'),
	file('docs/readme.md'),
]);

function mount(activePath: string | null = null) {
	return render(FileTree, { nodes: NODES, activePath, onopen: vi.fn() });
}

// Folder buttons carry their full path as the title; compact mode merges src → src/app.
const folder = (path: string): HTMLElement => screen.getByTitle(path);

describe('FileTree', () => {
	it('starts with every folder open and folds one away on a click', async () => {
		const user = userEvent.setup();
		mount();
		expect(screen.queryByText('one.ts')).toBeTruthy();
		await user.click(folder('src/app'));
		expect(screen.queryByText('one.ts')).toBeNull();
		expect(screen.queryByText('two.ts')).toBeNull();
		// The other branch of the tree is untouched.
		expect(screen.queryByText('readme.md')).toBeTruthy();
	});

	it('reopens a folded folder when the active file moves inside it', async () => {
		const user = userEvent.setup();
		const { rerender } = mount();
		await user.click(folder('src/app'));
		expect(screen.queryByText('one.ts')).toBeNull();

		// Keyboard browsing lands on a file the fold is hiding — the fold gives way.
		await rerender({ activePath: 'src/app/one.ts' });
		expect(screen.queryByText('one.ts')).toBeTruthy();
	});

	it('opens only the ancestors of the active file, not every fold', async () => {
		const user = userEvent.setup();
		const { rerender } = mount();
		await user.click(folder('src/app'));
		await user.click(folder('docs'));

		await rerender({ activePath: 'src/app/two.ts' });
		expect(screen.queryByText('two.ts')).toBeTruthy();
		expect(screen.queryByText('readme.md')).toBeNull();
	});
});
