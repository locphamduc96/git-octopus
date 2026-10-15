import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import FindWidget from './FindWidget.svelte';

function mount(over: Record<string, unknown> = {}) {
	const props = {
		query: 'fix',
		matchCount: 4,
		currentIndex: -1,
		error: null,
		partial: false,
		matchCase: false,
		regex: false,
		filter: false,
		onquery: vi.fn(),
		onstep: vi.fn(),
		onmatchCase: vi.fn(),
		onregex: vi.fn(),
		onfilter: vi.fn(),
		onclose: vi.fn(),
		...over,
	};
	render(FindWidget, props);
	return props;
}

describe('FindWidget', () => {
	it('counts matches, then shows the position once one is current', () => {
		mount();
		expect(screen.getByText('4 matches')).toBeTruthy();
	});

	it('shows the position of the current match', () => {
		mount({ currentIndex: 2 });
		expect(screen.getByText('3/4')).toBeTruthy();
	});

	it('says so when nothing matches, and shows a regex error in place of the count', () => {
		mount({ matchCount: 0 });
		expect(screen.getByText('No matches')).toBeTruthy();
	});

	it('shows the regex error instead of a count', () => {
		mount({ matchCount: 0, error: 'Invalid regex' });
		expect(screen.getByText('Invalid regex')).toBeTruthy();
	});

	it('steps forward on Enter and back on Shift+Enter, and closes on Escape', async () => {
		const props = mount();
		const input = screen.getByLabelText('Find commits');
		await fireEvent.keyDown(input, { key: 'Enter' });
		await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(props.onstep).toHaveBeenNthCalledWith(1, 1);
		expect(props.onstep).toHaveBeenNthCalledWith(2, -1);
		expect(props.onclose).toHaveBeenCalledOnce();
	});

	it('marks the latched options as pressed', () => {
		mount({ matchCase: true, filter: true });
		const pressed = (label: string) =>
			screen.getByLabelText(label).closest('button')?.getAttribute('aria-pressed');
		expect(pressed('Match case')).toBe('true');
		expect(pressed('Use regular expression')).toBe('false');
		expect(pressed('Show only matching commits')).toBe('true');
	});

	it('disables the step buttons when nothing matches', () => {
		mount({ matchCount: 0 });
		expect(screen.getByLabelText('Next match').closest('button')?.disabled).toBe(true);
	});
});
