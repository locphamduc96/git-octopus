import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import ContextMenu from './ContextMenu.svelte';

// jsdom lays nothing out, so the component's measurements all read 0 and it would never flip.
// These stubs stand in for one 200x300 menu in an 800x600 window.
const MENU_W = 200;
const MENU_H = 300;

function stubLayout(menuHeight = MENU_H): void {
	for (const [name, value] of [
		['offsetWidth', MENU_W],
		['offsetHeight', menuHeight],
		['scrollHeight', menuHeight],
	] as const) {
		vi.spyOn(HTMLElement.prototype, name, 'get').mockReturnValue(value);
	}
	vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
	vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
}

async function open(x: number, y: number, menuHeight?: number) {
	stubLayout(menuHeight);
	const { container } = render(ContextMenu, {
		x,
		y,
		items: [{ id: 'a', label: 'Checkout' }],
		onselect: vi.fn(),
		onclose: vi.fn(),
	});
	await tick();
	return container.querySelector('ul.menu') as HTMLElement;
}

afterEach(() => vi.restoreAllMocks());

describe('ContextMenu placement', () => {
	it('opens down and right of the pointer when there is room', async () => {
		const menu = await open(100, 100);
		expect(menu.style.left).toBe('100px');
		expect(menu.style.top).toBe('100px');
	});

	it('opens above the pointer when the menu would run off the bottom', async () => {
		const menu = await open(100, 500);
		expect(menu.style.top).toBe('200px');
	});

	it('opens left of the pointer when the menu would run off the right', async () => {
		const menu = await open(700, 100);
		expect(menu.style.left).toBe('500px');
	});

	it('clamps into view when neither side has room', async () => {
		const menu = await open(100, 500, 580);
		expect(menu.style.top).toBe('16px');
	});

	it('scrolls instead of overflowing when taller than the window', async () => {
		const menu = await open(100, 100, 900);
		expect(menu.classList.contains('scroll')).toBe(true);
		expect(menu.style.top).toBe('4px');
	});
});
