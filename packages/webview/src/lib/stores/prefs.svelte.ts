import { postToHost, readState, STATE_VERSION } from '../bridge';
import { onHostType } from '../hostRouter';
import type { FileViewMode } from '../fileTree';
import {
	DEFAULT_VIEW_SETTINGS,
	mergePreferences,
	type ColumnKey,
	type ColumnVisibility,
	type ColumnWidths,
	type GlobalPreferences,
	type ViewSettings,
} from '../viewSettings';

/**
 * Everything the user has chosen about how the view looks, and the only place that talks to the
 * host about it.
 *
 * Preferences are global, not per repository, so nothing here is cleared on a repo switch.
 */

const stored = readState();
// Sizes saved against a different layout are ignored, so a changed default still lands.
const saved = stored.version === STATE_VERSION ? stored : {};

// The defaults live in `lib/viewSettings`; the user's choices arrive as a `viewSettings` message
// and are laid over them by `mergePreferences`.
let settings = $state<ViewSettings>({ ...DEFAULT_VIEW_SETTINGS });
// Author is off by default: avatars now sit on the commit nodes, so the column is redundant.
let columns = $state<ColumnVisibility>({ author: false, commit: false, date: true });
let widths = $state<ColumnWidths>({
	ref: 180,
	author: 140,
	commit: 90,
	date: 150,
	...saved.widths,
});
let fileView = $state<FileViewMode>('tree');
let metaOpen = $state(false);

/**
 * Nothing is saved before the host has said what it holds.
 *
 * Without this the very first thing a fresh view does is post its *defaults* — which the host would
 * store, wiping the preferences it was about to send back. Every window opened would quietly reset
 * the settings of every other one.
 */
let preferencesLoaded = $state(false);
/**
 * What the host has, as far as this view knows. Two open panels each save and each receive the
 * other's save; without this they would answer each other forever over an unchanged value.
 *
 * Deliberately a plain variable: nothing renders it, and making it reactive would put a write
 * inside the effect that reads it.
 */
let syncedPreferences = '';

const listLoadedHooks: (() => void)[] = [];

function preferencesJson(): string {
	return JSON.stringify({ settings, columns, fileView, metaOpen });
}

function savePreferences(): void {
	if (!preferencesLoaded) return;
	const json = preferencesJson();
	if (json === syncedPreferences) return;
	syncedPreferences = json;
	postToHost({
		type: 'saveViewSettings',
		settings: { settings, columns, fileView, metaOpen } satisfies GlobalPreferences,
	});
}

function applyPreferences(incoming: Record<string, unknown> | null): void {
	preferencesLoaded = true;
	if (!incoming) {
		// Nothing stored: write the defaults once, so there is something to load next time.
		savePreferences();
		return;
	}
	const merged = mergePreferences({ settings, columns, fileView, metaOpen }, incoming);
	settings = merged.settings;
	columns = merged.columns;
	fileView = merged.fileView;
	metaOpen = merged.metaOpen;
	syncedPreferences = preferencesJson();
	for (const hook of listLoadedHooks) hook();
}

onHostType('viewSettings', (message) => applyPreferences(message.settings));

export const prefs = {
	get settings(): ViewSettings {
		return settings;
	},
	get columns(): ColumnVisibility {
		return columns;
	},
	get widths(): ColumnWidths {
		return widths;
	},
	get fileView(): FileViewMode {
		return fileView;
	},
	get metaOpen(): boolean {
		return metaOpen;
	},
	setSettings(next: ViewSettings): void {
		settings = next;
	},
	setFileView(next: FileViewMode): void {
		fileView = next;
	},
	setMetaOpen(open: boolean): void {
		metaOpen = open;
	},
	toggleColumn(column: keyof ColumnVisibility): void {
		columns = { ...columns, [column]: !columns[column] };
	},
	resizeColumn(column: ColumnKey, width: number): void {
		widths = { ...widths, [column]: width };
	},
	/** Post the current preferences unless the host already has them. Driven by an effect in `App`. */
	save: savePreferences,
	/**
	 * Run after the host's stored preferences land.
	 *
	 * The first `loadCommits` went out with the defaults, because the saved settings only arrive in
	 * answer to it. When they change what the host walk produces — order, limit, stashes, avatars —
	 * that first answer is already wrong, and only the graph knows whether it has to ask again.
	 */
	onLoaded(hook: () => void): void {
		listLoadedHooks.push(hook);
	},
};
