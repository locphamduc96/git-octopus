import type {
	Commit,
	CommitStat,
	GraphRow,
	Ref,
	SignatureStatus,
	UpstreamTracking,
} from '@git-octopus/shared';
import { fireEvent, render, screen } from '@testing-library/svelte';
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
	over: {
		showTracking?: boolean;
		refs?: Ref[];
		setFindMatches?: Set<string>;
		findCurrent?: string | null;
		columns?: { author: boolean; commit: boolean; date: boolean; changes: boolean };
		columnOrder?: ('author' | 'commit' | 'date' | 'changes')[];
		onreorderColumn?: (from: string, to: string) => void;
		mapCommitStats?: Record<string, CommitStat>;
		onneedStats?: (listHashes: string[]) => void;
		signature?: SignatureStatus;
		externalDrag?: { ref: string; label: string; local: boolean } | null;
		onexternalDragEnd?: () => void;
		oncheckFastForward?: (source: string, target: string, nonce: number) => void;
	} = {}
) {
	const only = row(over.refs ?? [{ kind: 'branch', name: 'main' }]);
	if (over.signature) only.commit.signature = over.signature;
	render(GraphView, {
		rows: [only],
		selectedHash: null,
		listSelectedHashes: [],
		currentBranch: 'main',
		lastPicked: null,
		columns: over.columns ?? { author: false, commit: false, date: false, changes: false },
		widths: { ref: 200, author: 120, commit: 80, date: 120, changes: 100 },
		columnOrder: over.columnOrder,
		onreorderColumn: over.onreorderColumn,
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
		setFindMatches: over.setFindMatches,
		findCurrent: over.findCurrent ?? null,
		onselect: vi.fn(),
		onselectRange: vi.fn(),
		oncompare: vi.fn(),
		oncompareWorking: vi.fn(),
		oncheckoutBranch: vi.fn(),
		onaction: vi.fn(),
		onmulti: vi.fn(),
		onloadMore: vi.fn(),
		onbranchAction: vi.fn(),
		onfilterBranch: vi.fn(),
		oncheckFastForward: over.oncheckFastForward ?? vi.fn(),
		externalDrag: over.externalDrag,
		onexternalDragEnd: over.onexternalDragEnd,
		ontoggleColumn: vi.fn(),
		onresizeColumn: vi.fn(),
		mapCommitStats: over.mapCommitStats,
		onneedStats: over.onneedStats,
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

describe('GraphView find highlight', () => {
	const rowOf = () => screen.getByText('subject').closest('.row');

	it('marks a matching row, and the current match apart from the rest', () => {
		mount({}, { setFindMatches: new Set(['a'.repeat(40)]), findCurrent: 'a'.repeat(40) });
		expect(rowOf()?.classList.contains('find-match')).toBe(true);
		expect(rowOf()?.classList.contains('find-current')).toBe(true);
	});

	it('leaves a row unmarked when nothing is being found', () => {
		mount({});
		expect(rowOf()?.classList.contains('find-match')).toBe(false);
		expect(rowOf()?.classList.contains('find-current')).toBe(false);
	});
});

describe('GraphView ghost branch', () => {
	function mountTwoRows(currentBranch: string) {
		const tip = { ...row([{ kind: 'branch', name: 'feature' }]) };
		tip.commit = { ...tip.commit, hash: 't'.repeat(40), parents: ['b'.repeat(40)], subject: 'tip' };
		const below = { ...row([]) };
		below.commit = { ...below.commit, hash: 'b'.repeat(40), subject: 'below' };
		const oncheckoutBranch = vi.fn();
		render(GraphView, {
			rows: [tip, below],
			selectedHash: 'b'.repeat(40),
			listSelectedHashes: [],
			currentBranch,
			lastPicked: null,
			columns: { author: false, commit: false, date: false, changes: false },
			widths: { ref: 200, author: 120, commit: 80, date: 120, changes: 100 },
			compareHash: null,
			dateType: 'commit',
			graphStyle: 'rounded',
			rowDensity: 'comfortable',
			highlightHover: false,
			muteMerges: false,
			showTicketBadge: false,
			showTypeBadge: false,
			showTracking: false,
			mapTracking: {},
			showGhostBranch: true,
			headHash: null,
			fastForward: null,
			scrollTarget: null,
			hasMore: false,
			onselect: vi.fn(),
			onselectRange: vi.fn(),
			oncompare: vi.fn(),
			oncompareWorking: vi.fn(),
			oncheckoutBranch,
			onaction: vi.fn(),
			onmulti: vi.fn(),
			onloadMore: vi.fn(),
			onbranchAction: vi.fn(),
			onfilterBranch: vi.fn(),
			oncheckFastForward: vi.fn(),
			ontoggleColumn: vi.fn(),
			onresizeColumn: vi.fn(),
		});
		return oncheckoutBranch;
	}

	it('checks the branch of the line out on a double-click', async () => {
		const oncheckoutBranch = mountTwoRows('main');
		const ghost = document.querySelector('button.ghost') as HTMLElement;
		expect(ghost.textContent).toBe('feature');
		ghost.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		expect(oncheckoutBranch).toHaveBeenCalledWith('feature', null);
	});

	it('does nothing for the branch already checked out', () => {
		const oncheckoutBranch = mountTwoRows('feature');
		(document.querySelector('button.ghost') as HTMLElement).dispatchEvent(
			new MouseEvent('dblclick', { bubbles: true })
		);
		expect(oncheckoutBranch).not.toHaveBeenCalled();
	});
});

describe('GraphView column order', () => {
	const ALL = { author: true, commit: true, date: true, changes: false };
	const headerLabels = () =>
		[...document.querySelectorAll('.hlabel.movable')].map((label) => label.textContent?.trim());

	it('lays the header and the cells out in the stored order', () => {
		mount({}, { columns: ALL, columnOrder: ['date', 'author', 'commit'] });
		expect(headerLabels()).toEqual(['Date', 'Author', 'Commit']);
		const cells = [...(document.querySelector('.row')?.children ?? [])].map(
			(cell) => cell.className
		);
		const at = (name: string) => cells.findIndex((className) => className.includes(name));
		expect(at('date')).toBeLessThan(at('author'));
		expect(at('author')).toBeLessThan(at('mono'));
	});

	it('moves a column when its label is dropped on another', async () => {
		const onreorderColumn = vi.fn();
		mount({}, { columns: ALL, onreorderColumn });
		const listLabels = [...document.querySelectorAll('.hlabel.movable')] as HTMLElement[];
		await fireEvent.dragStart(listLabels[0]);
		await fireEvent.drop(listLabels[2].closest('.hcell') as HTMLElement);
		expect(onreorderColumn).toHaveBeenCalledWith('author', 'date');
	});
});

describe('GraphView drop of a ref dragged in from outside', () => {
	it('takes the drop on a branch chip and reports the drag as consumed', async () => {
		const oncheckFastForward = vi.fn();
		const onexternalDragEnd = vi.fn();
		mount(
			{},
			{
				oncheckFastForward,
				onexternalDragEnd,
				externalDrag: { ref: 'refs/remotes/origin/dev', label: 'origin/dev', local: false },
			}
		);
		const chip = screen.getByText('main').closest('.ref') as HTMLElement;
		await fireEvent.dragOver(chip);
		await fireEvent.drop(chip);
		expect(oncheckFastForward).toHaveBeenCalledWith('refs/remotes/origin/dev', 'main', 1);
		expect(onexternalDragEnd).toHaveBeenCalledOnce();
	});

	it('ignores a drop while nothing is being dragged', async () => {
		const oncheckFastForward = vi.fn();
		mount({}, { oncheckFastForward });
		await fireEvent.drop(screen.getByText('main').closest('.ref') as HTMLElement);
		expect(oncheckFastForward).not.toHaveBeenCalled();
	});
});

describe('GraphView Changes column', () => {
	const changesOn = { author: false, commit: false, date: false, changes: true };

	it('asks for the sizes of the rows on screen once it is shown', async () => {
		vi.useFakeTimers();
		try {
			const onneedStats = vi.fn();
			mount({}, { columns: changesOn, onneedStats });
			expect(onneedStats).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(200);
			expect(onneedStats).toHaveBeenCalledWith(['a'.repeat(40)]);
		} finally {
			vi.useRealTimers();
		}
	});

	it('asks for nothing while the column is hidden', async () => {
		vi.useFakeTimers();
		try {
			const onneedStats = vi.fn();
			mount({}, { onneedStats });
			await vi.advanceTimersByTimeAsync(200);
			expect(onneedStats).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('shows the lines added and removed', () => {
		const hash = 'a'.repeat(40);
		mount(
			{},
			{
				columns: changesOn,
				mapCommitStats: { [hash]: { hash, files: 2, insertions: 12, deletions: 3 } },
			}
		);
		expect(screen.getByText('+12')).toBeTruthy();
		expect(screen.getByText('−3')).toBeTruthy();
	});
});

describe('signature badge', () => {
	it('marks a signed commit, coloured and explained by its status', () => {
		mount({}, { signature: 'bad' });
		const badge = screen.getByRole('img', { name: /Bad signature/ });
		expect(badge.closest('.signature')?.classList.contains('bad')).toBe(true);
	});

	it('draws nothing for a commit with no signature', () => {
		mount({});
		expect(document.querySelector('.signature')).toBeNull();
	});
});

describe('GraphView working tree, HEAD and chip looks', () => {
	const WT = 'w'.repeat(40);
	const HEAD = 'c'.repeat(40);
	const BASE = 'b'.repeat(40);
	const lane = (hash: string) => ({ hash, colour: 0, branch: 0 });

	/** Working tree → HEAD (main, tag v1) → base, all on one lane. */
	function mountHeadGraph() {
		const wt = row([]);
		wt.commit = {
			...wt.commit,
			hash: WT,
			parents: [HEAD],
			subject: 'Uncommitted Changes (1)',
			isUncommitted: true,
		};
		wt.listOutputLanes = [lane(HEAD)];
		wt.listParentColumns = [0];
		const head = row([
			{ kind: 'branch', name: 'main' },
			{ kind: 'tag', name: 'v1' },
		]);
		head.commit = { ...head.commit, hash: HEAD, parents: [BASE], subject: 'feat(ui): soft chips' };
		head.listInputLanes = [lane(HEAD)];
		head.listOutputLanes = [lane(BASE)];
		head.listParentColumns = [0];
		const base = row([]);
		base.commit = { ...base.commit, hash: BASE, subject: 'base' };
		base.listInputLanes = [lane(BASE)];
		const { container } = render(GraphView, {
			rows: [wt, head, base],
			selectedHash: null,
			listSelectedHashes: [],
			currentBranch: 'main',
			lastPicked: null,
			columns: { author: false, commit: false, date: false, changes: false },
			widths: { ref: 200, author: 120, commit: 80, date: 120, changes: 100 },
			compareHash: null,
			dateType: 'commit',
			graphStyle: 'rounded',
			rowDensity: 'comfortable',
			highlightHover: false,
			muteMerges: false,
			showTicketBadge: true,
			showTypeBadge: true,
			showTracking: false,
			mapTracking: {},
			showGhostBranch: false,
			headHash: HEAD,
			fastForward: null,
			scrollTarget: null,
			hasMore: false,
			onselect: vi.fn(),
			onselectRange: vi.fn(),
			oncompare: vi.fn(),
			oncompareWorking: vi.fn(),
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
		return container;
	}

	/** The dash pattern of every line in each row's band, top row first. */
	function dashesByRow(container: HTMLElement): (string | null)[][] {
		return [...container.querySelectorAll('svg.lines > g')].map((band) =>
			[...band.querySelectorAll(':scope > path')].map((path) =>
				path.getAttribute('stroke-dasharray')
			)
		);
	}

	it('dashes the line from the working tree down to HEAD, and only that line', () => {
		expect(dashesByRow(mountHeadGraph())).toEqual([['3 3'], ['3 3', null], [null]]);
	});

	it('rings the checked-out commit with a halo', () => {
		const container = mountHeadGraph();
		const listBands = [...container.querySelectorAll('svg.lines > g')];
		expect(listBands.map((band) => band.querySelectorAll('circle.head-halo').length)).toEqual([
			0, 1, 0,
		]);
	});

	it('marks the checked-out chip by class, not by a lane colour written on it', () => {
		mountHeadGraph();
		const chip = screen.getByText('main').closest('.ref');
		expect(chip?.classList.contains('current')).toBe(true);
		expect(chip?.getAttribute('style') ?? '').not.toContain('border-color');
	});

	it('leaves the tag icon unfilled, coloured by the stylesheet', () => {
		const container = mountHeadGraph();
		expect(container.querySelector('.ref.tag .glyph')?.getAttribute('style')).toBeNull();
	});

	it('colours a type chip from its theme token, with no outline colour', () => {
		mountHeadGraph();
		const style = screen.getByText('feat(ui)').getAttribute('style') ?? '';
		expect(style).toContain('var(--gg-type-feat)');
		expect(style).not.toContain('border-color');
	});
});
