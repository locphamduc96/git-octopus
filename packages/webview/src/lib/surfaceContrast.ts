/*
 * Panes are told apart by tone (feature-117): the control bar and the side panel sit on the sidebar
 * colour, the graph on the editor's. A theme that paints the two the same leaves nothing to tell them
 * apart, so below this contrast ratio the root gets `gg-flat-surfaces` and tokens.css lifts the
 * raised tone. Measured: Dark Modern 1.077, Light Modern 1.062, the desktop app's dark 1.065.
 */
export const MIN_SURFACE_CONTRAST = 1.05;
export const FLAT_SURFACES_CLASS = 'gg-flat-surfaces';

type Rgb = [number, number, number];

/** A computed colour, `rgb(r, g, b)` or `rgba(r, g, b, a)`; null when transparent or unreadable. */
export function parseRgb(text: string): Rgb | null {
	const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(
		text.trim()
	);
	if (!match) return null;
	if (match[4] !== undefined && parseFloat(match[4]) === 0) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function channel(value: number): number {
	const ratio = value / 255;
	return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. */
export function luminance([r, g, b]: Rgb): number {
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
	const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (light + 0.05) / (dark + 0.05);
}

/** True when the two computed colours are too close for tone alone to separate the panes. */
export function isFlat(editor: string, sidebar: string): boolean {
	const listRgb = [parseRgb(editor), parseRgb(sidebar)];
	if (!listRgb[0] || !listRgb[1]) return false;
	return contrastRatio(listRgb[0], listRgb[1]) < MIN_SURFACE_CONTRAST;
}

/** Resolves a token to its computed colour through a hidden probe element. */
function readColour(probe: HTMLElement, token: string): string {
	probe.style.backgroundColor = `var(${token})`;
	return getComputedStyle(probe).backgroundColor;
}

/**
 * Sets `gg-flat-surfaces` on the root now and whenever the theme changes: VS Code rewrites the
 * root's style and the body's class, the desktop app flips `data-theme`. Returns a stop function.
 */
export function watchSurfaceContrast(doc: Document = document): () => void {
	const root = doc.documentElement;
	const probe = doc.createElement('span');
	probe.setAttribute('aria-hidden', 'true');
	probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none';
	doc.body.append(probe);

	const update = (): void => {
		const isFlatNow = isFlat(readColour(probe, '--gg-bg'), readColour(probe, '--gg-bg-sidebar'));
		if (root.classList.contains(FLAT_SURFACES_CLASS) !== isFlatNow) {
			root.classList.toggle(FLAT_SURFACES_CLASS, isFlatNow);
		}
	};

	const observer = new MutationObserver(update);
	observer.observe(root, { attributes: true, attributeFilter: ['style', 'data-theme'] });
	observer.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
	update();

	return () => {
		observer.disconnect();
		probe.remove();
	};
}
