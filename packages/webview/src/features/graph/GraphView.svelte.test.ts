import type { Commit, GraphRow, Ref, UpstreamTracking } from '@git-octopus/shared';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import GraphView from './GraphView.svelte';

function commit(refs: Ref[]): Commit {
	return {
		hash: 'a'.repeat(40),
		parents: [],
		author: { name: 'A', email: 'a@example.com' },
		committedAt: 0,
		authoredAt: 0,
		subject: 'subject',
		refs,
	};
}

function row(refs: Ref[]): GraphRow {
	return {
		commit: commit(refs),
		nodeColumn: 0,
		nodeColour: 0,
		nodeBranch: 0,
		listInputLanes: [],
		listOutputLanes: [],
		listParentColumns: [],
	};
}

const track = (over: Partial<UpstreamTracking> = {}): UpstreamTracking => ({
	upstream: 'origin/main',
	ahead: 0,
	behind: 0,
	gone: false,
	...over,
});

function mount(
	mapTracking: Record<string, UpstreamTracking | null>,
	over: { showTracking?: boolean; refs?: Ref[] } = {}
) {
	render(GraphView, {
		rows: [row(over.refs ?? [{ kind: 'branch', name: 'main' }])],
		selectedHash: null,
		listSelectedHashes: [],
		currentBranch: 'main',
		lastPicked: null,
		columns: { author: false, commit: false, date: false },
		widths: { ref: 200, author: 120, commit: 80, date: 120 },
		compareHash: null,
		dateType: 'commit',
		graphStyle: 'rounded',
		rowDensity: 'comfortable',
		highlightHover: false,
		muteMerges: false,
		showTicketBadge: false,
		showTypeBadge: false,
		showTracking: over.showTracking ?? true,
		mapTracking,
		showGhostBranch: false,
		headHash: null,
		fastForward: null,
		scrollTarget: null,
		hasMore: false,
		onselect: vi.fn(),
		onselectRange: vi.fn(),
		oncompare: vi.fn(),
		oncheckoutBranch: vi.fn(),
		onaction: vi.fn(),
		onmulti: vi.fn(),
		onloadMore: vi.fn(),
		onbranchAction: vi.fn(),
		onfilterBranch: vi.fn(),
		oncheckFastForward: vi.fn(),
		ontoggleColumn: vi.fn(),
		onresizeColumn: vi.fn(),
	});
}

/** The chip's own element, so a match cannot come from the row's other cells. */
function chipText(): string {
	const chip = screen.getByText('main').closest('.ref');
	return chip?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('GraphView upstream drift badge', () => {
	it('draws nothing while a branch is level with its upstream', () => {
		mount({ main: track() });
		expect(chipText()).toBe('main');
	});

	it('draws nothing for a branch with no upstream at all', () => {
		mount({});
		expect(chipText()).toBe('main');
	});

	it('draws the behind count on its own', () => {
		mount({ main: track({ behind: 12 }) });
		expect(chipText()).toContain('↓12');
		expect(chipText()).not.toContain('↑');
	});

	it('draws the ahead count on its own', () => {
		mount({ main: track({ ahead: 3 }) });
		expect(chipText()).toContain('↑3');
		expect(chipText()).not.toContain('↓');
	});

	// No space between them here: the gap is CSS, which jsdom does not fold into textContent.
	it('draws both counts for a diverged branch, ahead first', () => {
		mount({ main: track({ ahead: 3, behind: 12 }) });
		expect(chipText()).toContain('↑3↓12');
	});

	it('draws a question mark rather than a number it could not read', () => {
		mount({ main: track({ behind: null }) });
		expect(chipText()).toContain('↓?');
		expect(chipText()).not.toContain('↓0');
	});

	it('says the upstream is gone instead of showing counts', () => {
		mount({ main: track({ gone: true }) });
		expect(chipText()).toContain('gone');
		expect(chipText()).not.toContain('↓');
	});

	it('draws nothing when the setting is off', () => {
		mount({ main: track({ ahead: 3, behind: 12 }) }, { showTracking: false });
		expect(chipText()).toBe('main');
	});

	it('draws nothing on a chip that stands only for a remote branch', () => {
		mount(
			{ main: track({ behind: 12 }) },
			{ refs: [{ kind: 'branch', name: 'main', remote: 'origin' }] }
		);
		expect(chipText()).not.toContain('↓12');
	});
});
