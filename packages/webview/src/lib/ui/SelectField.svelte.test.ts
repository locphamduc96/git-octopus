import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import SelectFieldHarness from './SelectField.harness.svelte';

describe('SelectField', () => {
	it('is still a native select, named for screen readers, showing its value', () => {
		render(SelectFieldHarness, { onchange: vi.fn() });
		const select = screen.getByRole('combobox', { name: 'Pull strategy' }) as HTMLSelectElement;
		expect(select.tagName).toBe('SELECT');
		expect(select.value).toBe('config');
	});

	it('reports the option picked', async () => {
		const onchange = vi.fn();
		render(SelectFieldHarness, { onchange });
		await fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rebase' } });
		expect(onchange).toHaveBeenCalledWith('rebase');
	});
});
