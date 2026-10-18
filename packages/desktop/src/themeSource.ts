import { readFileSync } from 'node:fs';
import type { ThemeSource } from './ipc.js';

export const LIST_THEME_SOURCES: readonly ThemeSource[] = ['system', 'light', 'dark'];

/**
 * Where the host keeps the view's preferences in `state.json`. Main reads the theme from there at
 * launch, before any host exists, and must not import the controller for one string; a test pins
 * this to the controller's own constant.
 */
export const VIEW_SETTINGS_KEY = 'gitOctopus.viewSettings';

/** The theme source a stored value names; anything else follows macOS. */
export function parseThemeSource(raw: unknown): ThemeSource {
	return LIST_THEME_SOURCES.find((source) => source === raw) ?? 'system';
}

/**
 * Hands the theme a saved settings blob names to `apply`, every time. A save is never skipped as
 * "unchanged": the native theme belongs to the app, all tabs share it, and what this host last
 * sent may have been overtaken by another tab.
 */
export function followSavedTheme(
	settings: { theme?: unknown } | null,
	apply: (source: ThemeSource) => void
): void {
	apply(parseThemeSource(settings?.theme));
}

/** The theme the user chose last time, read straight from the state file. */
export function readStoredThemeSource(stateFile: string): ThemeSource {
	try {
		const state = JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, unknown>;
		const stored = state[VIEW_SETTINGS_KEY] as { settings?: { theme?: unknown } } | undefined;
		return parseThemeSource(stored?.settings?.theme);
	} catch {
		return 'system';
	}
}
