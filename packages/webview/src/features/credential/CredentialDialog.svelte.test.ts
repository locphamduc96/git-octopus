import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import CredentialDialog from './CredentialDialog.svelte';

const TITLE = 'Git Octopus: push — octo-repo → example.invalid';

function mount(overrides: { prompt?: string; secret?: boolean; confirm?: boolean } = {}) {
	const callbacks = { onanswer: vi.fn(), oncancel: vi.fn() };
	const result = render(CredentialDialog, {
		title: TITLE,
		prompt: "Password for 'https://octo@example.invalid':",
		secret: true,
		confirm: false,
		...overrides,
		...callbacks,
	});
	return { ...callbacks, ...result };
}

describe('CredentialDialog', () => {
	it('shows the title the host set and git’s question as text', () => {
		mount();
		expect(screen.getByRole('dialog', { name: TITLE })).toBeTruthy();
		expect(screen.getByText("Password for 'https://octo@example.invalid':")).toBeTruthy();
	});

	it('shows markup in git’s question as characters, never as elements', () => {
		const { container } = mount({ prompt: 'Password <img src=x onerror=alert(1)> <b>for</b> you' });
		expect(container.querySelector('img')).toBeNull();
		expect(container.querySelector('.prompt b')).toBeNull();
		expect(container.querySelector('.prompt')?.textContent).toBe(
			'Password <img src=x onerror=alert(1)> <b>for</b> you'
		);
	});

	it('masks a secret answer and sends what was typed on Enter', async () => {
		const { onanswer } = mount();
		const field = screen.getByLabelText('Password') as HTMLInputElement;
		expect(field.type).toBe('password');
		expect(document.activeElement).toBe(field);
		await userEvent.type(field, 'hunter2{Enter}');
		expect(onanswer).toHaveBeenCalledWith('hunter2');
	});

	it('sends what was typed when OK is pressed', async () => {
		const { onanswer } = mount();
		await userEvent.type(screen.getByLabelText('Password'), 'hunter2');
		await userEvent.click(screen.getByRole('button', { name: 'OK' }));
		expect(onanswer).toHaveBeenCalledWith('hunter2');
	});

	it('shows a username in the clear', () => {
		mount({ prompt: "Username for 'https://example.invalid':", secret: false });
		const field = screen.getByLabelText('Username') as HTMLInputElement;
		expect(field.type).toBe('text');
	});

	it('cancels with the button and with Escape, sending no answer', async () => {
		const { onanswer, oncancel } = mount();
		await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(oncancel).toHaveBeenCalledTimes(1);
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(oncancel).toHaveBeenCalledTimes(2);
		expect(onanswer).not.toHaveBeenCalled();
	});

	describe('a yes/no question', () => {
		const hostKey =
			'The authenticity of host example.invalid cannot be established. Are you sure you want to continue connecting (yes/no/[fingerprint])?';

		it('has two buttons and no field, even though the host marked it secret', () => {
			mount({ prompt: hostKey, secret: true, confirm: true });
			expect(screen.queryByLabelText('Password')).toBeNull();
			expect(screen.queryByRole('textbox')).toBeNull();
			expect(screen.getByText(hostKey)).toBeTruthy();
			const listLabels = [...document.querySelectorAll('footer button')].map(
				(button) => button.textContent
			);
			expect(listLabels).toEqual(['No', 'Yes']);
		});

		it('answers yes or no with the buttons, and focuses the refusal', async () => {
			const { onanswer } = mount({ prompt: hostKey, secret: true, confirm: true });
			expect(document.activeElement).toBe(screen.getByRole('button', { name: 'No' }));
			await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
			expect(onanswer).toHaveBeenLastCalledWith('yes');
			await userEvent.click(screen.getByRole('button', { name: 'No' }));
			expect(onanswer).toHaveBeenLastCalledWith('no');
		});

		it('counts Escape as no answer at all', async () => {
			const { onanswer, oncancel } = mount({ prompt: hostKey, secret: true, confirm: true });
			await fireEvent.keyDown(window, { key: 'Escape' });
			expect(oncancel).toHaveBeenCalledTimes(1);
			expect(onanswer).not.toHaveBeenCalled();
		});
	});
});
