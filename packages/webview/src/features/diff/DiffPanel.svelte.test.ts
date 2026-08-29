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
		expect(screen.getByText(/a line 2/)).toBeTruthy();
		expect(container.querySelector('.flash')).toBeTruthy();
	});

	it('survives the diff being swapped underneath it, repeatedly', async () => {
		const { rerender, container } = mount();
		for (let round = 0; round < 3; round++) {
			await rerender({ path: `src/file-${round}.ts`, listHunks: [hunk(30, 5 + round, `r${round}`)] });
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
});
