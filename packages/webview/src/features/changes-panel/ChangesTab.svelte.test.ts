import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { WorkingTreeStatus } from '@git-octopus/shared';

vi.stubGlobal('acquireVsCodeApi', () => ({
	postMessage: () => {},
	getState: () => undefined,
	setState: () => undefined,
}));

const { dispatchHostMessage } = await import('../../lib/hostRouter');
const { default: ChangesTab } = await import('./ChangesTab.svelte');

const working: WorkingTreeStatus = {
	staged: [{ status: 'M', path: 'src/board.ts' }],
	unstaged: [],
};

function mount() {
	const onaction = vi.fn();
	render(ChangesTab, {
		working,
		ahead: 0,
		fileView: 'list',
		activePath: null,
		onaction,
		onopenFile: vi.fn(),
		onmenu: vi.fn(),
		onpush: vi.fn(),
		onpushForce: vi.fn(),
	});
	return onaction;
}

const summary = () =>
	screen.queryByPlaceholderText('Short description of the change') as HTMLInputElement | null;

async function commitWith(text: string): Promise<void> {
	await fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
	await fireEvent.input(summary() as HTMLInputElement, { target: { value: text } });
	await fireEvent.keyDown(summary() as HTMLInputElement, { key: 'Enter' });
}

describe('ChangesTab commit dialog', () => {
	it('comes back with the message when the host refuses the commit', async () => {
		const onaction = mount();
		await commitWith('test chan-hook');
		expect(onaction).toHaveBeenCalledWith('commit', undefined, 'test chan-hook', {
			noVerify: false,
			pushAfter: false,
		});
		expect(summary()).toBeNull();
		dispatchHostMessage({ type: 'commitOutcome', ok: false });
		expect(
			(await screen.findByPlaceholderText('Short description of the change')) as HTMLInputElement
		).toHaveProperty('value', 'test chan-hook');
	});

	it('drops the draft on Cancel', async () => {
		mount();
		await commitWith('feat: dropped');
		dispatchHostMessage({ type: 'commitOutcome', ok: false });
		await screen.findByPlaceholderText('Short description of the change');
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
		expect(summary()?.value).toBe('');
	});

	it('forgets the draft once the commit lands, and does not reopen', async () => {
		mount();
		await commitWith('feat: landed');
		dispatchHostMessage({ type: 'commitOutcome', ok: true });
		expect(summary()).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
		expect(summary()?.value).toBe('');
	});
});
