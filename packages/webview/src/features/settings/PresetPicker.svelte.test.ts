import { describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import PresetPicker, { CUSTOM } from './PresetPicker.svelte';
import PresetPickerHarness from './PresetPicker.harness.svelte';

const LIST_OPTIONS = [
	{ value: '', label: 'Default' },
	{ value: 'fast', label: 'Fast' },
	{ value: CUSTOM, label: 'Custom…' },
];

function mount(value: string) {
	const onsave = vi.fn();
	const utils = render(PresetPicker, {
		label: 'Model',
		listOptions: LIST_OPTIONS,
		value,
		customPlaceholder: 'model id',
		onsave,
	});
	return { onsave, ...utils };
}

const input = (): HTMLInputElement | null => document.querySelector('input.model');

describe('PresetPicker', () => {
	it('saves a preset on click and never opens the free-text field for it', async () => {
		const user = userEvent.setup();
		const { onsave } = mount('');
		await user.click(screen.getByRole('radio', { name: 'Fast' }));
		expect(onsave).toHaveBeenCalledExactlyOnceWith('fast');
		expect(input()).toBeNull();
	});

	it('shows a stored value no preset carries as custom, in the free-text field', () => {
		mount('my/exotic-model');
		expect(screen.getByRole('radio', { name: 'Custom…' }).getAttribute('aria-checked')).toBe(
			'true'
		);
		expect(input()?.value).toBe('my/exotic-model');
	});

	// The broadcast tests go through the harness, which reproduces `SettingsWidget`'s real wiring:
	// the host answers every save by replacing the whole settings object, and `value` reaches the
	// picker through a `$derived` of its own. That derived is what keeps an equal-valued broadcast
	// from notifying anyone — passing the prop directly would fail the contract by construction.
	it('keeps a half-typed draft when the host broadcasts the same stored value back', async () => {
		const user = userEvent.setup();
		const { component } = render(PresetPickerHarness, {
			listOptions: LIST_OPTIONS,
			initial: '',
			onsave: vi.fn(),
		});
		await user.click(screen.getByRole('radio', { name: 'Custom…' }));
		await user.type(input()!, 'llama');
		expect(input()!.value).toBe('llama');

		flushSync(() => component.broadcast(''));
		expect(input()!.value).toBe('llama');
	});

	it('lets a genuinely new stored value replace the draft', async () => {
		const user = userEvent.setup();
		const { component } = render(PresetPickerHarness, {
			listOptions: LIST_OPTIONS,
			initial: '',
			onsave: vi.fn(),
		});
		await user.click(screen.getByRole('radio', { name: 'Custom…' }));
		await user.type(input()!, 'llama');

		flushSync(() => component.broadcast('fast'));
		expect(input()).toBeNull();
		expect(screen.getByRole('radio', { name: 'Fast' }).getAttribute('aria-checked')).toBe('true');
	});

	it('saves the typed value on Enter', async () => {
		const user = userEvent.setup();
		const { onsave } = mount('');
		await user.click(screen.getByRole('radio', { name: 'Custom…' }));
		await user.type(input()!, 'llama{Enter}');
		expect(onsave).toHaveBeenCalledWith('llama');
	});
});
