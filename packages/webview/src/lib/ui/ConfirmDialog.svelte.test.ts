import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ConfirmDialog from './ConfirmDialog.svelte';

describe('ConfirmDialog footer', () => {
	it('puts Cancel first and the main action last, in the right-hand corner', () => {
		render(ConfirmDialog, {
			title: 'Delete branch',
			message: 'Delete feature/old?',
			confirmLabel: 'Delete',
			cancelLabel: 'Cancel',
			danger: true,
			onconfirm: vi.fn(),
			oncancel: vi.fn(),
		});
		const listLabels = [...document.querySelectorAll('footer button')].map(
			(button) => button.textContent
		);
		expect(listLabels).toEqual(['Cancel', 'Delete']);
		expect(screen.getByRole('button', { name: 'Delete' }).classList.contains('danger')).toBe(true);
	});
});
