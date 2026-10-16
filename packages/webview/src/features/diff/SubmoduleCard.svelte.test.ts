import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import SubmoduleCard from './SubmoduleCard.svelte';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

describe('SubmoduleCard', () => {
	it('names the move and opens the submodule’s own graph', async () => {
		const onopen = vi.fn();
		render(SubmoduleCard, {
			path: 'libs/engine',
			submodule: { from: A, to: B, dirty: false, repoPath: '/r/libs/engine' },
			onopen,
		});
		expect(screen.getByText('aaaaaaaa')).toBeTruthy();
		expect(screen.getByText('bbbbbbbb')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Open submodule' }));
		expect(onopen).toHaveBeenCalledWith('/r/libs/engine');
	});

	it('says how to check it out instead, when it is not', () => {
		render(SubmoduleCard, {
			path: 'libs/engine',
			submodule: { to: B, dirty: false, repoPath: null },
			onopen: () => {},
		});
		expect(screen.queryByRole('button', { name: 'Open submodule' })).toBeNull();
		expect(screen.getByText('git submodule update --init libs/engine')).toBeTruthy();
		expect(screen.getByText(/is added at/)).toBeTruthy();
	});

	it('warns that a dirty checkout holds more than the pointer shows', () => {
		render(SubmoduleCard, {
			path: 'libs/engine',
			submodule: { from: A, to: A, dirty: true, repoPath: '/r/libs/engine' },
			onopen: () => {},
		});
		expect(screen.getByText(/still points at/)).toBeTruthy();
		expect(screen.getByText(/changes of its own/)).toBeTruthy();
	});
});
