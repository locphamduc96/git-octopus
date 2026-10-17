import type { CommitDetails } from '@git-octopus/shared';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CommitTab from './CommitTab.svelte';

const details: CommitDetails = {
	hash: '5498ee93bd37a12d082e04598ffe5e6d5e2f78ba',
	parents: ['a931acfa00000000000000000000000000000000'],
	author: { name: 'Loc Pham', email: 'loc@example.com' },
	authoredAt: 0,
	committer: { name: 'Loc Pham', email: 'loc@example.com' },
	committedAt: 0,
	body: 'feat: show every week\n\nDrop the isPublished filter.',
	files: [],
	signature: { status: 'good', signer: 'loc@example.com', key: 'SHA256:abc' },
};

function mount(metaOpen: boolean) {
	const oncopy = vi.fn();
	const onselectCommit = vi.fn();
	const { container } = render(CommitTab, {
		details,
		loading: false,
		fileView: 'list',
		activePath: null,
		metaOpen,
		onmetaOpen: vi.fn(),
		onopenDiff: vi.fn(),
		onmenu: vi.fn(),
		oncopy,
		onselectCommit,
	});
	return { container, oncopy, onselectCommit };
}

describe('CommitTab meta', () => {
	it('shows author, hash, parent and signature with the message folded', () => {
		const { container } = mount(false);
		const meta = container.querySelector('.meta') as HTMLElement;
		expect(meta.textContent).toContain('Loc Pham');
		expect(meta.textContent).toContain('5498ee93');
		expect(meta.textContent).toContain('a931acfa');
		expect(meta.querySelector('.signature.good .key')?.textContent).toBe('SHA256:abc');
		expect(container.querySelector('.body')).toBeNull();
	});

	it('shows the rest of the message once unfolded', () => {
		const { container } = mount(true);
		expect(container.querySelector('.body')?.textContent).toBe('Drop the isPublished filter.');
	});

	it('copies the full hash, and opens the parent rather than copying it', async () => {
		const { oncopy, onselectCommit } = mount(false);
		await fireEvent.click(screen.getByTitle(`Copy the full hash ${details.hash}`));
		expect(oncopy).toHaveBeenCalledWith(details.hash);
		await fireEvent.click(screen.getByTitle(`Show ${details.parents[0]}`));
		expect(onselectCommit).toHaveBeenCalledWith(details.parents[0]);
	});
});
