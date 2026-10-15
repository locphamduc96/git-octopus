import { expect, type Locator } from '@playwright/test';
import type { Session } from './session.js';

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (text: string): RegExp => new RegExp(`^${escapeRegExp(text)}$`);

/** Conventional-commit types the graph lifts out of the subject into a chip of their own. */
const CHIP_TYPE = /^(feat|fix|chore|refactor|docs|test|perf|build|ci|style|revert)(\([^)]*\))?!?: /;

/**
 * The graph row whose subject contains `subject`. Written the way git has it (`docs: explain
 * scoring`); the row shows the type as a chip and the rest as text, so only the rest is matched.
 */
export function row(s: Session, subject: string): Locator {
	const text = escapeRegExp(subject.replace(CHIP_TYPE, ''));
	// Anchored at the end, so `scoreboard` does not land on `rename scoreboard to board`; a count
	// such as the Uncommitted row's `(3)` may follow.
	const subjectText = s.graph.locator('.subject', {
		hasText: new RegExp(`${text}(\\s*\\(\\d+\\))?\\s*$`),
	});
	return s.graph.locator('.row', { has: subjectText }).first();
}

/** The selected row(s). */
export function selectedRow(s: Session): Locator {
	return s.graph.locator('.row.selected');
}

/** The chip whose name is exactly `name` (a remote-only chip shows the branch without its remote). */
export function chip(s: Session, name: string): Locator {
	return s.graph
		.locator('button.ref', { has: s.graph.locator('.ref-name', { hasText: exact(name) }) })
		.first();
}

/**
 * A chip that may sit folded behind a "+N" on a crowded row: hovering the row's ref cell unfolds
 * every ref at full length, the way a user reaches it.
 */
export async function reachChip(s: Session, name: string, onRow: string): Promise<Locator> {
	const direct = chip(s, name);
	if (await direct.isVisible()) return direct;
	await row(s, onRow).locator('button.ref').first().hover();
	const unfolded = s.graph
		.locator('.ref-expand button.ref', {
			has: s.graph.locator('.ref-name', { hasText: exact(name) }),
		})
		.first();
	await unfolded.waitFor();
	return unfolded;
}

/**
 * Drop one chip on another through the view's own drag handlers: dragstart on the source, then
 * dragover and drop on the target, sharing one DataTransfer. A pointer drag across a long graph has
 * to scroll mid-gesture, and the drop then lands wherever the scroll left the pointer.
 */
export async function dragChip(from: Locator, to: Locator): Promise<void> {
	await from.scrollIntoViewIfNeeded();
	const dataTransfer = await from.evaluateHandle(() => new DataTransfer());
	await from.dispatchEvent('dragstart', { dataTransfer });
	await to.scrollIntoViewIfNeeded();
	const centre = await to.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return { clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
	});
	await to.dispatchEvent('dragenter', { dataTransfer, ...centre });
	await to.dispatchEvent('dragover', { dataTransfer, ...centre });
	await to.dispatchEvent('drop', { dataTransfer, ...centre });
	await from.dispatchEvent('dragend', { dataTransfer });
}

/** Right-click `target` and pick `label` from the menu it opens (a submenu path is `a > b`). */
export async function menu(s: Session, target: Locator, label: string | RegExp): Promise<void> {
	await target.click({ button: 'right' });
	const item = s.graph.locator('ul.menu button', { hasText: label }).first();
	await item.click();
}

/** The view's own dialog (confirmations, text input, editors), by title when given. */
export function dialog(s: Session, title?: string | RegExp): Locator {
	// The Settings panel is a dialog too, and stays open under the questions it raises.
	const listDialogs = s.graph.locator('[role="dialog"]:not([aria-label="Settings"])');
	if (title === undefined) return listDialogs.last();
	return typeof title === 'string'
		? s.graph.locator(`[role="dialog"][aria-label="${title}"]`)
		: listDialogs.filter({ has: s.graph.locator('.title', { hasText: title }) });
}

/** Press a button inside the most recent dialog. */
export async function answer(s: Session, button: string | RegExp): Promise<void> {
	const box = dialog(s);
	await box.getByRole('button', { name: button }).click();
}

/** A section of the working-tree panel: Conflicts, Changes, Untracked or Staged Changes. */
export function section(
	s: Session,
	title: 'Conflicts' | 'Changes' | 'Untracked' | 'Staged Changes'
): Locator {
	return s.graph.locator('section', {
		has: s.graph.locator('h3', { hasText: new RegExp(`^${title}\\b`) }),
	});
}

/** The file row named `name` (its last path segment) among the rows on show. */
export function file(scope: Locator, name: string): Locator {
	return scope
		.locator(`.file-row:has(.name:text-is(${JSON.stringify(name)}))`)
		.filter({ visible: true })
		.first();
}

/** The inline diff panel. */
export function diff(s: Session): Locator {
	return s.graph.locator('.diff');
}

/** Close the inline diff if it is open — it covers the graph while it is. */
export async function closeDiff(s: Session): Promise<void> {
	const close = diff(s).getByRole('button', { name: 'Close the diff' });
	if (await close.isVisible()) await close.click();
	await expect(diff(s)).toHaveCount(0);
}

/** The visible button named exactly `name` — some panels keep a hidden twin mounted. */
export function button(scope: Session | Locator, name: string): Locator {
	const root = 'graph' in scope ? scope.graph : scope;
	return root.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
}

/** Press the confirming button of the dialog on top (the view's ConfirmDialog). */
export async function confirm(s: Session): Promise<void> {
	await dialog(s).locator('button.confirm').click();
}

/** A VS Code notification whose text contains `text`. */
export function toast(s: Session, text: string | RegExp): Locator {
	return s.page.locator('.notification-toast', { hasText: text });
}

/** The checked-out branch, straight from git. */
export function head(s: Session): string {
	try {
		return s.git('symbolic-ref', '--short', '-q', 'HEAD').trim();
	} catch {
		// Mid-rebase HEAD is detached for a moment; a poll reads it again.
		return '(detached)';
	}
}

/** Wait until git agrees — the view refreshes after the host has run the command. */
export async function eventually(read: () => string, expected: string | RegExp): Promise<void> {
	await expect.poll(read, { timeout: 20_000 }).toMatch(expected);
}

/**
 * The horizontal centre of the graph node drawn on `rowLocator`'s line, measured inside the webview
 * so the row and the node share one coordinate space.
 */
export async function nodeX(rowLocator: Locator): Promise<number> {
	return rowLocator.evaluate((rowElement) => {
		const rowBox = rowElement.getBoundingClientRect();
		const centreY = rowBox.y + rowBox.height / 2;
		const listOnRow = [...document.querySelectorAll('svg circle')]
			.map((circle) => circle.getBoundingClientRect())
			.filter((rect) => rect.width >= 7 && Math.abs(rect.y + rect.height / 2 - centreY) < 4);
		if (listOnRow.length === 0) throw new Error('no node on that row');
		return listOnRow[0].x + listOnRow[0].width / 2;
	});
}
