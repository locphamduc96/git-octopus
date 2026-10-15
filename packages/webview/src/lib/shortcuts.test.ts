import { describe, expect, it } from 'vitest';
import { formatKeys, isShortcutListKey, LIST_SHORTCUT_GROUPS } from './shortcuts';

const key = (over: Partial<Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>>) => ({
	key: '',
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	...over,
});

describe('formatKeys', () => {
	it('spells Mod as Ctrl off macOS and leaves the rest alone', () => {
		expect(formatKeys('Mod+H', false)).toBe('Ctrl+H');
		expect(formatKeys('Alt+↑', false)).toBe('Alt+↑');
	});

	it('uses the macOS symbols', () => {
		expect(formatKeys('Mod+H', true)).toBe('⌘H');
		expect(formatKeys('Alt+↓', true)).toBe('⌥↓');
		expect(formatKeys('Shift+Enter', true)).toBe('⇧Enter');
	});
});

describe('isShortcutListKey', () => {
	it('opens on ? alone and on Mod+/', () => {
		expect(isShortcutListKey(key({ key: '?' }))).toBe(true);
		expect(isShortcutListKey(key({ key: '/', metaKey: true }))).toBe(true);
		expect(isShortcutListKey(key({ key: '/', ctrlKey: true }))).toBe(true);
	});

	it('ignores / alone and ? with a modifier', () => {
		expect(isShortcutListKey(key({ key: '/' }))).toBe(false);
		expect(isShortcutListKey(key({ key: '?', altKey: true }))).toBe(false);
	});
});

describe('LIST_SHORTCUT_GROUPS', () => {
	it('lists the branch and lane steps', () => {
		const listLabels = LIST_SHORTCUT_GROUPS.flatMap((group) => group.listItems.map((i) => i.label));
		expect(listLabels).toContain('Previous / next commit on the same branch');
		expect(listLabels).toContain('Nearest commit on the lane to the left / right');
	});
});
