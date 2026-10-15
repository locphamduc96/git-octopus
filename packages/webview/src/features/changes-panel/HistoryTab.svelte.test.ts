import type { FileHistoryEntry } from '@git-octopus/shared';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import HistoryTab from './HistoryTab.svelte';

const entry = (
	hash: string,
	subject: string,
	over: Partial<FileHistoryEntry> = {}
): FileHistoryEntry => ({
	hash: hash.repeat(40).slice(0, 40),
	subject,
	author: { name: 'Ada', email: 'ada@example.com' },
	authoredAt: 1_700_000_000,
	status: 'M',
	path: 'src/new.ts',
	...over,
});

function mount(over: Record<string, unknown> = {}) {
	const props = {
		path: 'src/new.ts',
		listEntries: [
			entry('c', 'edit after the move'),
			entry('b', 'move it', { status: 'R', oldPath: 'src/old.ts' }),
			entry('a', 'add it', { status: 'A', path: 'src/old.ts' }),
		],
		loading: false,
		truncated: false,
		error: null,
		activeHash: null,
		onopen: vi.fn(),
		onreveal: vi.fn(),
		...over,
	};
	render(HistoryTab, props);
	return props;
}

describe('HistoryTab', () => {
	it('lists each commit and says when the file had another name', () => {
		mount();
		expect(screen.getByText('edit after the move')).toBeTruthy();
		expect(screen.getByText(/as old\.ts/)).toBeTruthy();
		expect(screen.getByText('3 commits')).toBeTruthy();
	});

	it('opens an entry, and reveals one in the graph from its own button', async () => {
		const props = mount();
		await fireEvent.click(screen.getByText('move it'));
		expect(props.onopen).toHaveBeenCalledWith(expect.objectContaining({ subject: 'move it' }));
		await fireEvent.click(
			screen.getAllByLabelText('Show in graph')[0].closest('button') as HTMLElement
		);
		expect(props.onreveal).toHaveBeenCalledWith('c'.repeat(40));
	});

	it('shows the error instead of a list', () => {
		mount({ error: 'fatal: bad revision' });
		expect(screen.getByText('fatal: bad revision')).toBeTruthy();
	});
});
