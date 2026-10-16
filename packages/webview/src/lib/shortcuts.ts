/**
 * Every keyboard shortcut the view answers, for the list `?` opens.
 *
 * `Mod` is Cmd on macOS and Ctrl elsewhere; `formatKeys` spells it for the platform. Kept as data
 * beside the handlers' file rather than read out of them, so the list is checked by a test and not
 * by memory.
 */
export interface ShortcutGroup {
	title: string;
	listItems: { keys: string[]; label: string }[];
}

export const LIST_SHORTCUT_GROUPS: ShortcutGroup[] = [
	{
		title: 'Graph',
		listItems: [
			{ keys: ['↑', '↓'], label: 'Previous / next commit' },
			{ keys: ['Alt+↑', 'Alt+↓'], label: 'Previous / next commit on the same branch' },
			{ keys: ['←', '→'], label: 'Nearest commit on the lane to the left / right' },
			{ keys: ['Shift+↑', 'Shift+↓'], label: 'Extend the selection' },
			{ keys: ['PageUp', 'PageDown'], label: 'Up / down one screen' },
			{ keys: ['Home', 'End'], label: 'First / last loaded commit' },
			{ keys: ['Mod+click'], label: 'Compare with the selected commit' },
			{ keys: ['Mod+H'], label: 'Jump to HEAD' },
			{ keys: ['Mod+S'], label: 'Jump to the latest stash' },
			{ keys: ['Mod+R'], label: 'Reload the graph' },
			{ keys: ['Mod+B'], label: 'Create a branch at the selected commit (HEAD when none)' },
			{ keys: ['Mod+L'], label: 'Fetch all remotes' },
			{ keys: ['Mod+Z'], label: 'Undo the last action that moved a branch' },
			{ keys: ['Mod+Shift+Z', 'Mod+Y'], label: 'Redo what was just undone' },
		],
	},
	{
		title: 'Find',
		listItems: [
			{ keys: ['Mod+F'], label: 'Find commits' },
			{ keys: ['Enter', 'F3'], label: 'Next match' },
			{ keys: ['Shift+Enter', 'Shift+F3'], label: 'Previous match' },
			{ keys: ['Esc'], label: 'Close find' },
		],
	},
	{
		title: 'Diff',
		listItems: [
			{ keys: ['↑', '↓'], label: 'Previous / next file of the commit' },
			{ keys: ['Alt+↑', 'Alt+↓'], label: 'Move along the branch, diff stays open' },
		],
	},
	{
		title: 'Help',
		listItems: [{ keys: ['?', 'Mod+/'], label: 'Show this list' }],
	},
];

/** `Mod+H` → `⌘H` on macOS, `Ctrl+H` elsewhere; other modifiers follow the same convention. */
export function formatKeys(keys: string, isMac: boolean): string {
	if (!isMac) return keys.replace(/\bMod\b/g, 'Ctrl');
	return keys
		.replace(/\bMod\+/g, '⌘')
		.replace(/\bAlt\+/g, '⌥')
		.replace(/\bShift\+/g, '⇧');
}

/** Whether the keystroke opens the shortcut list: `?` on its own, or Mod+/. */
export function isShortcutListKey(
	event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>
): boolean {
	if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey) return true;
	return event.key === '/' && (event.ctrlKey || event.metaKey);
}
