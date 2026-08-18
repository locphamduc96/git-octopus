const SHOW_DELAY_MS = 300;
const GAP = 6;

export interface TooltipOptions {
	text: string;
	/** How long the pointer must rest before the tooltip appears. */
	delay?: number;
}

type TooltipArg = string | TooltipOptions;

function normalise(arg: TooltipArg): Required<TooltipOptions> {
	return typeof arg === 'string'
		? { text: arg, delay: SHOW_DELAY_MS }
		: { text: arg.text, delay: arg.delay ?? SHOW_DELAY_MS };
}

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

function place(target: Element, text: string): void {
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
 * Pass `{ text, delay }` where a slower reveal is wanted instead — detail a pointer should have to
 * ask for, rather than meet on its way past.
 *
 * The text is written as `textContent`, never markup: some of it comes out of the repository.
 */
export function tooltip(node: Element, arg: TooltipArg) {
	let current = normalise(arg);

	const open = (): void => {
		clearTimeout(timer);
		if (current.text === '') return;
		const { text, delay } = current;
		timer = setTimeout(() => place(node, text), delay);
	};

	node.addEventListener('mouseenter', open);
	node.addEventListener('focus', open);
	node.addEventListener('mouseleave', hide);
	node.addEventListener('blur', hide);
	node.addEventListener('click', hide);
	window.addEventListener('scroll', hide, true);

	return {
		update(next: TooltipArg) {
			current = normalise(next);
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
