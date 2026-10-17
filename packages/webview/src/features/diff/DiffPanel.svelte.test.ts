import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { DiffHunk } from '@git-octopus/shared';
import DiffPanel from './DiffPanel.svelte';

// jsdom draws nothing: elements have no scrollTo and no ResizeObserver. The panel only needs
// them to exist — the virtual window falls back to its initial 600px viewport.
beforeAll(() => {
	Element.prototype.scrollTo = function (this: Element, options?: ScrollToOptions | number) {
		if (typeof options === 'object' && options?.top !== undefined) this.scrollTop = options.top;
	} as typeof Element.prototype.scrollTo;
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
});

/** One hunk of `context` lines with a two-line change at `changeAt`. */
function hunk(lineCount: number, changeAt: number, stamp: string): DiffHunk {
	return {
		oldStart: 1,
		newStart: 1,
		heading: '',
		listLines: Array.from({ length: lineCount }, (_, index) => ({
			kind: index === changeAt || index === changeAt + 1 ? ('add' as const) : ('context' as const),
			text: `${stamp} line ${index}`,
			oldLine: index + 1,
			newLine: index + 1,
		})),
	};
}

function mount(props: Partial<Parameters<typeof render<typeof DiffPanel>>[1]> = {}) {
	return render(DiffPanel, {
		path: 'src/a.ts',
		title: 'Working Tree',
		listHunks: [hunk(40, 2, 'a')],
		listLineTokens: null,
		notice: null,
		loading: false,
		mode: 'full' as const,
		onmode: vi.fn(),
		onclose: vi.fn(),
		...props,
	});
}

describe('DiffPanel', () => {
	it('mounts on a real diff, lands on the first change and flashes it — no effect loop (0.19.13)', () => {
		// The bug this guards: the landing $effect called flashChange, which wrote state the effect
		// itself read — effect_update_depth_exceeded, and the whole view froze on open. A plain
		// mount is the regression: the loop, if reintroduced, throws right here.
		const { container } = mount();
		expect(screen.getByText(/a line 2$/)).toBeTruthy();
		expect(container.querySelector('.flash')).toBeTruthy();
	});

	it('survives the diff being swapped underneath it, repeatedly', async () => {
		const { rerender, container } = mount();
		for (let round = 0; round < 3; round++) {
			await rerender({
				path: `src/file-${round}.ts`,
				listHunks: [hunk(30, 5 + round, `r${round}`)],
			});
		}
		expect(screen.getByText(/r2 line 5/)).toBeTruthy();
		expect(container.querySelector('.flash')).toBeTruthy();
	});

	it('virtualises: rows far outside the viewport are not in the DOM', () => {
		mount({ listHunks: [hunk(2000, 0, 'big')] });
		// 600px viewport at 18px rows plus overscan ⇒ the window ends near row 54.
		expect(screen.getByText(/big line 1\b/)).toBeTruthy();
		expect(screen.queryByText(/big line 1500\b/)).toBeNull();
	});

	it('counts the stats from the hunks it was handed', () => {
		mount();
		// Two added lines, no deletions.
		expect(screen.getByText('+2')).toBeTruthy();
		expect(screen.getByText('−0')).toBeTruthy();
	});

	it('sizes the scroll area to the widest line of the whole file, not of the rows on screen', () => {
		// Row 180 is far below the first screenful and its overscan, so it is not rendered — its
		// width must count anyway, or the sideways bar would change length as scrolling brought it in.
		const long = hunk(200, 2, 'a');
		long.listLines[180] = { ...long.listLines[180], text: 'x'.repeat(300) };
		const { container } = mount({ listHunks: [long] });
		expect(screen.queryByText('x'.repeat(300))).toBeNull();
		const spacer = container.querySelector<HTMLElement>('.spacer-v');
		// +1 column for the +/- marker; jsdom reorders the calc() terms, so only the part that
		// comes from the line is pinned.
		expect(spacer?.style.width).toContain('301ch');
	});

	it('draws long lines whole instead of cutting them off', () => {
		const long = hunk(10, 2, 'a');
		long.listLines[0] = { ...long.listLines[0], text: `import { X } from "${'y'.repeat(200)}";` };
		mount({ listHunks: [long] });
		expect(screen.getByText(new RegExp(`${'y'.repeat(200)}";$`))).toBeTruthy();
	});
});

describe('DiffPanel layouts', () => {
	const replaced: DiffHunk = {
		oldStart: 1,
		newStart: 1,
		heading: '',
		listLines: [
			{ kind: 'context', text: 'keep', oldLine: 1, newLine: 1 },
			{ kind: 'del', text: 'old text', oldLine: 2, newLine: null },
			{ kind: 'add', text: 'new text', oldLine: null, newLine: 2 },
		],
	};

	it('draws a replaced line as one row with the old and the new side by side', () => {
		const { container } = mount({ listHunks: [replaced], layout: 'split' });
		// The changed word is its own span, so the row is found from its half, not from one text node.
		const row = container.querySelector('.half.del')?.closest('.row');
		expect(row?.classList.contains('pair')).toBe(true);
		expect(row?.querySelector('.half.del')?.textContent).toContain('old text');
		expect(row?.querySelector('.half.add')?.textContent).toContain('new text');
		// The kept line shows on both sides.
		expect(container.querySelectorAll('.half.context')).toHaveLength(2);
	});

	it('keeps one column per line in the unified layout', () => {
		const { container } = mount({ listHunks: [replaced] });
		expect(container.querySelector('.row.pair')).toBeNull();
		expect(container.querySelectorAll('.row.del, .row.add')).toHaveLength(2);
	});

	it('latches the toggles, and wraps whatever the wrap setting says in split view', () => {
		mount({ listHunks: [replaced], layout: 'split', ignoreWhitespace: true });
		const button = (label: string) => screen.getByLabelText(label).closest('button');
		expect(button('Side by side')?.getAttribute('aria-pressed')).toBe('true');
		expect(button('Ignore whitespace')?.getAttribute('aria-pressed')).toBe('true');
		expect(button('Wrap long lines')?.getAttribute('aria-pressed')).toBe('true');
		expect(button('Wrap long lines')?.disabled).toBe(true);
	});

	it('reports each toggle to its own callback', async () => {
		const onlayout = vi.fn();
		const onwrap = vi.fn();
		const onwhitespace = vi.fn();
		mount({ listHunks: [replaced], onlayout, onwrap, onwhitespace });
		const button = (label: string) => screen.getByLabelText(label).closest('button') as HTMLElement;
		button('Side by side').click();
		button('Wrap long lines').click();
		button('Ignore whitespace').click();
		expect(onlayout).toHaveBeenCalledWith('split');
		expect(onwrap).toHaveBeenCalledOnce();
		expect(onwhitespace).toHaveBeenCalledOnce();
	});
});

describe('DiffPanel blame', () => {
	const A = 'a'.repeat(40);
	const B = 'b'.repeat(40);
	const fileHunk: DiffHunk = {
		oldStart: 1,
		newStart: 1,
		heading: '',
		listLines: ['one', 'two', 'three'].map((text, index) => ({
			kind: 'context' as const,
			text,
			oldLine: index + 1,
			newLine: index + 1,
		})),
	};
	const blame = {
		listLineHashes: [A, A, B],
		mapCommits: {
			[A]: { author: 'Ada', authoredAt: 0, summary: 'first' },
			[B]: { author: 'Grace', authoredAt: 0, summary: 'second' },
		},
	};

	it('writes one annotation per run of lines from the same commit', () => {
		const { container } = mount({ listHunks: [fileHunk], blame, canTrace: true });
		const listLabels = [...container.querySelectorAll('button.blame')].map((b) => b.textContent);
		expect(listLabels).toHaveLength(2);
		expect(listLabels[0]).toContain('aaaaaaa Ada');
		expect(listLabels[1]).toContain('bbbbbbb Grace');
	});

	it('reveals the commit an annotation names', () => {
		const onrevealCommit = vi.fn();
		const { container } = mount({ listHunks: [fileHunk], blame, canTrace: true, onrevealCommit });
		(container.querySelectorAll('button.blame')[1] as HTMLElement).click();
		expect(onrevealCommit).toHaveBeenCalledWith(B);
	});

	it('hides the diff-only controls and latches Blame', () => {
		mount({ listHunks: [fileHunk], blame, canTrace: true });
		expect(screen.queryByText('Whole file')).toBeNull();
		expect(screen.queryByLabelText('Side by side')).toBeNull();
		expect(screen.getByLabelText('Blame').closest('button')?.getAttribute('aria-pressed')).toBe(
			'true'
		);
	});

	it('disables blame and history for a file without a revision', () => {
		mount({ canTrace: false });
		expect(screen.getByLabelText('Blame').closest('button')?.disabled).toBe(true);
		expect(screen.getByLabelText('File history').closest('button')?.disabled).toBe(true);
	});
});

describe('DiffPanel picking lines', () => {
	const change: DiffHunk = {
		oldStart: 1,
		newStart: 1,
		heading: '',
		listLines: [
			{ kind: 'context', text: 'a', oldLine: 1, newLine: 1 },
			{ kind: 'del', text: 'b', oldLine: 2, newLine: null },
			{ kind: 'add', text: 'B', oldLine: null, newLine: 2 },
			{ kind: 'add', text: 'C', oldLine: null, newLine: 3 },
		],
	};
	const pickButtons = (container: HTMLElement) =>
		[...container.querySelectorAll('button.gutter')] as HTMLButtonElement[];

	it('offers nothing to pick outside a working-tree diff', () => {
		const { container } = mount({ listHunks: [change], mode: 'compact' });
		expect(pickButtons(container)).toHaveLength(0);
		expect(screen.queryByText('Stage hunk')).toBeNull();
	});

	it('picks a line from its number, then sends exactly that line to be staged', async () => {
		const onstageLines = vi.fn();
		const { container } = mount({ listHunks: [change], staging: 'unstaged', onstageLines });
		// Two number buttons per changed line; the third changed line is the added `C`.
		pickButtons(container)[4].click();
		await Promise.resolve();
		(await screen.findByText('Stage 1 line')).click();
		expect(onstageLines).toHaveBeenCalledWith('stage', [
			{ kind: 'add', oldLine: null, newLine: 3, text: 'C' },
		]);
	});

	it('picks a range with Shift+click', async () => {
		const onstageLines = vi.fn();
		const { container } = mount({ listHunks: [change], staging: 'staged', onstageLines });
		const listButtons = pickButtons(container);
		listButtons[0].click();
		listButtons[4].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
		(await screen.findByText('Unstage 3 lines')).click();
		expect(onstageLines.mock.calls[0][1]).toHaveLength(3);
	});

	it('stages or discards a whole hunk from its header row', () => {
		const onstageLines = vi.fn();
		mount({ listHunks: [change], mode: 'compact', staging: 'unstaged', onstageLines });
		screen.getByText('Discard hunk').click();
		expect(onstageLines).toHaveBeenCalledWith('discard', [
			{ kind: 'del', oldLine: 2, newLine: null, text: 'b' },
			{ kind: 'add', oldLine: null, newLine: 2, text: 'B' },
			{ kind: 'add', oldLine: null, newLine: 3, text: 'C' },
		]);
	});

	it('picks lines side by side too, a Shift range staying on its own half', async () => {
		const twoByTwo: DiffHunk = {
			oldStart: 1,
			newStart: 1,
			heading: '',
			listLines: [
				{ kind: 'del', text: 'd1', oldLine: 1, newLine: null },
				{ kind: 'del', text: 'd2', oldLine: 2, newLine: null },
				{ kind: 'add', text: 'a1', oldLine: null, newLine: 1 },
				{ kind: 'add', text: 'a2', oldLine: null, newLine: 2 },
			],
		};
		const onstageLines = vi.fn();
		const { container } = mount({
			listHunks: [twoByTwo],
			layout: 'split',
			staging: 'unstaged',
			onstageLines,
		});
		const half = (row: number, side: 'del' | 'add') =>
			container.querySelectorAll(`.half.${side} button.gutter`)[row] as HTMLButtonElement;
		// Both old lines by a range down the left half.
		half(0, 'del').click();
		half(1, 'del').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
		await Promise.resolve();
		expect(container.querySelectorAll('.half.picked')).toHaveLength(2);
		// Shift on the other half picks that one line, not a range across halves.
		half(1, 'add').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
		(await screen.findByText('Stage 3 lines')).click();
		expect(onstageLines).toHaveBeenCalledWith('stage', [
			{ kind: 'del', oldLine: 1, newLine: null, text: 'd1' },
			{ kind: 'del', oldLine: 2, newLine: null, text: 'd2' },
			{ kind: 'add', oldLine: null, newLine: 2, text: 'a2' },
		]);
	});

	it('does not offer picking while whitespace is ignored', () => {
		const { container } = mount({
			listHunks: [change],
			staging: 'unstaged',
			ignoreWhitespace: true,
		});
		expect(pickButtons(container)).toHaveLength(0);
	});

	it('marks the words that changed inside an edited line, and only with the setting on', () => {
		const edit: DiffHunk = {
			oldStart: 1,
			newStart: 1,
			heading: '',
			listLines: [
				{ kind: 'del', text: 'export const combo = { value: 0 };', oldLine: 2, newLine: null },
				{
					kind: 'add',
					text: 'export const combo = { value: 0, best: 0 };',
					oldLine: null,
					newLine: 2,
				},
			],
		};
		const { container, unmount } = mount({ listHunks: [edit] });
		const listMarked = [...container.querySelectorAll('.emph')].map((node) => node.textContent);
		expect(listMarked).toEqual([', best: 0']);
		unmount();
		const off = mount({ listHunks: [edit], intraline: false });
		expect(off.container.querySelectorAll('.emph')).toHaveLength(0);
	});
});

describe('DiffPanel tab size', () => {
	it('draws tabs as wide as the editor does', () => {
		const { container } = mount({ tabSize: 2 });
		expect(
			(container.querySelector('.diff') as HTMLElement).style.getPropertyValue('--tab-size')
		).toBe('2');
	});

	it('falls back to four columns before the host says', () => {
		const { container } = mount();
		expect(
			(container.querySelector('.diff') as HTMLElement).style.getPropertyValue('--tab-size')
		).toBe('4');
	});
});
