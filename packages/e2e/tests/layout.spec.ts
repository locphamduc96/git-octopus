import { expect, test } from '@playwright/test';
import { useSession, type Session } from '../src/session.js';
import { menu } from '../src/ui.js';

// The graph in a narrow window — a laptop screen with the details panel open. Sized here rather
// than left to the display, so the result is the same on any machine.
let s: Session;
useSession((session) => (s = session), {
	settings: { 'window.zoomLevel': 0, 'window.newWindowDimensions': 'default' },
});

const header = (label: string) =>
	s.graph.locator('.hcell', { has: s.graph.locator('.hlabel', { hasText: label }) });

test.beforeAll(async () => {
	await s.app.evaluate(({ BrowserWindow }) => {
		const win = BrowserWindow.getAllWindows()[0];
		win.unmaximize();
		win.setSize(1100, 780);
	});
	for (const column of ['Author', 'Changes']) {
		await menu(s, s.graph.locator('.hcell', { hasText: 'Description' }), column);
	}
});

test('L.1 Description keeps its width when every column is on', async () => {
	await expect(header('Changes')).toHaveCount(1);
	const width = await header('Description').evaluate((el) => el.getBoundingClientRect().width);
	expect(width).toBeGreaterThanOrEqual(200);
});

test('L.2 the header scrolls with the rows and never lies under the details panel', async () => {
	const scroll = s.graph.locator('.scroll');
	await scroll.evaluate((el) => {
		el.scrollLeft = el.scrollWidth;
		el.dispatchEvent(new Event('scroll'));
	});
	const { covered, offset } = await header('Changes').evaluate((cell) => {
		const box = cell.getBoundingClientRect();
		const top = cell.ownerDocument.elementFromPoint(
			box.left + box.width / 2,
			box.top + box.height / 2
		);
		const firstRow = cell.ownerDocument.querySelector('.scroll .row');
		const columnsOnRow = firstRow ? [...firstRow.children] : [];
		// The Changes cell is the row's last grid child; the header above it must line up with it.
		const last = columnsOnRow.at(-1)?.getBoundingClientRect();
		return { covered: !cell.contains(top), offset: last ? Math.abs(last.left - box.left) : -1 };
	});
	expect(covered).toBe(false);
	expect(offset).toBeLessThan(2);
});

test('L.3 a column header is still dragged into place', async () => {
	const labels = () => s.graph.locator('.hlabel.movable').allInnerTexts();
	await expect.poll(labels).toEqual(['Author', 'Date', 'Changes']);
	await s.graph.locator('.hlabel.movable', { hasText: 'Changes' }).dragTo(header('Author'));
	await expect.poll(labels).toEqual(['Changes', 'Author', 'Date']);
});
