import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import IconButton from './IconButton.svelte';

// The harness smoke test: a real component mounts, reacts and unmounts under jsdom. If this
// fails, every other `.svelte.test.ts` failure is the setup's fault, not the component's.
describe('IconButton', () => {
	it('mounts as a button named by its label and forwards the click', async () => {
		const onclick = vi.fn();
		render(IconButton, { name: 'trash', label: 'Delete', onclick });
		const button = screen.getByRole('button', { name: 'Delete' });
		await userEvent.click(button);
		expect(onclick).toHaveBeenCalledOnce();
	});

	it('does not fire while disabled', async () => {
		const onclick = vi.fn();
		render(IconButton, { name: 'trash', label: 'Delete', disabled: true, onclick });
		await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
		expect(onclick).not.toHaveBeenCalled();
	});
});
