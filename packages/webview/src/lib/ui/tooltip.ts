const SHOW_DELAY_MS = 300;
const GAP = 6;

let element: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function ensureElement(): HTMLDivElement {
	if (!element) {
		element = document.createElement('div');
		element.className = 'gg-tooltip';
		element.setAttribute('role', 'tooltip');
		document.body.appendChild(element);
	}
	return element;
}

function place(target: HTMLElement, text: string): void {
	const tip = ensureElement();
	tip.textContent = text;
	tip.style.visibility = 'hidden';
	tip.style.display = 'block';

	const anchor = target.getBoundingClientRect();
	const size = tip.getBoundingClientRect();

	// Prefer below the control; flip above when the viewport bottom is too close.
	const below = anchor.bottom + GAP;
	const top = below + size.height > window.innerHeight ? anchor.top - size.height - GAP : below;
	const centred = anchor.left + anchor.width / 2 - size.width / 2;
	const left = Math.max(GAP, Math.min(centred, window.innerWidth - size.width - GAP));

	tip.style.top = `${Math.max(GAP, top)}px`;
	tip.style.left = `${left}px`;
	tip.style.visibility = 'visible';
}

function hide(): void {
	clearTimeout(timer);
	if (element) element.style.display = 'none';
}

/**
 * Show an explanatory tooltip on hover or focus.
 *
 * The native `title` attribute waits one to two seconds before appearing, which is long enough that
 * icon-only controls read as unexplained; this shows the same text quickly and in the app's style.
 */
export function tooltip(node: HTMLElement, text: string) {
	let current = text;

	const open = (): void => {
		clearTimeout(timer);
		if (current === '') return;
		timer = setTimeout(() => place(node, current), SHOW_DELAY_MS);
	};

	node.addEventListener('mouseenter', open);
	node.addEventListener('focus', open);
	node.addEventListener('mouseleave', hide);
	node.addEventListener('blur', hide);
	node.addEventListener('click', hide);
	window.addEventListener('scroll', hide, true);

	return {
		update(next: string) {
			current = next;
		},
		destroy() {
			hide();
			node.removeEventListener('mouseenter', open);
			node.removeEventListener('focus', open);
			node.removeEventListener('mouseleave', hide);
			node.removeEventListener('blur', hide);
			node.removeEventListener('click', hide);
			window.removeEventListener('scroll', hide, true);
		},
	};
}
