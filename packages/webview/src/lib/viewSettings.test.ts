import { describe, expect, it } from 'vitest';
import {
	DEFAULT_VIEW_SETTINGS,
	LIST_COMMIT_ORDERS,
	LIST_DATE_TYPES,
	LIST_DIFF_TARGETS,
	LIST_GRAPH_STYLES,
	mergePreferences,
	pickOption,
	settingsRequireReload,
	type GlobalPreferences,
	type ViewSettings,
} from './viewSettings';

function currentPreferences(): GlobalPreferences {
	return {
		settings: { ...DEFAULT_VIEW_SETTINGS },
		columns: { author: false, commit: false, date: true },
		fileView: 'tree',
		metaOpen: false,
	};
}

describe('mergePreferences', () => {
	it('lays stored values over the defaults', () => {
		const merged = mergePreferences(currentPreferences(), {
			settings: { graphStyle: 'curved', commitLimit: 500 },
			columns: { author: true },
			fileView: 'list',
			metaOpen: true,
		});
		expect(merged.settings.graphStyle).toBe('curved');
		expect(merged.settings.commitLimit).toBe(500);
		expect(merged.columns).toEqual({ author: true, commit: false, date: true });
		expect(merged.fileView).toBe('list');
		expect(merged.metaOpen).toBe(true);
	});

	it('keeps the default for keys an older blob is missing', () => {
		const merged = mergePreferences(currentPreferences(), {
			settings: { commitLimit: 100 },
		});
		expect(merged.settings.autoFastForwardOnCheckout).toBe(true);
		expect(merged.settings.rowDensity).toBe('comfortable');
		expect(merged.fileView).toBe('tree');
		expect(merged.metaOpen).toBe(false);
	});

	it('ignores sections the blob does not carry', () => {
		const merged = mergePreferences(currentPreferences(), {});
		expect(merged).toEqual(currentPreferences());
	});

	it('does not read metaOpen from a non-boolean value', () => {
		const merged = mergePreferences(currentPreferences(), { metaOpen: 'yes' });
		expect(merged.metaOpen).toBe(false);
	});

	it('does not mutate the current preferences', () => {
		const current = currentPreferences();
		mergePreferences(current, { settings: { commitLimit: 1000 }, columns: { date: false } });
		expect(current.settings.commitLimit).toBe(300);
		expect(current.columns.date).toBe(true);
	});
});

describe('settingsRequireReload', () => {
	const listWalkFields: (keyof ViewSettings)[] = [
		'commitLimit',
		'fetchAvatars',
		'commitOrder',
		'showRemoteBranches',
		'showTags',
		'showStashes',
		'showUncommitted',
	];

	function changed<K extends keyof ViewSettings>(key: K, value: ViewSettings[K]): ViewSettings {
		return { ...DEFAULT_VIEW_SETTINGS, [key]: value };
	}

	it('asks for a reload when a field the host walk depends on changes', () => {
		expect(settingsRequireReload(DEFAULT_VIEW_SETTINGS, changed('commitLimit', 1000))).toBe(true);
		expect(settingsRequireReload(DEFAULT_VIEW_SETTINGS, changed('fetchAvatars', true))).toBe(true);
		expect(settingsRequireReload(DEFAULT_VIEW_SETTINGS, changed('commitOrder', 'topo'))).toBe(true);
		expect(settingsRequireReload(DEFAULT_VIEW_SETTINGS, changed('showRemoteBranches', false))).toBe(
			true
		);
		expect(settingsRequireReload(DEFAULT_VIEW_SETTINGS, changed('showTags', false))).toBe(true);
		expect(settingsRequireReload(DEFAULT_VIEW_SETTINGS, changed('showStashes', false))).toBe(true);
		expect(settingsRequireReload(DEFAULT_VIEW_SETTINGS, changed('showUncommitted', false))).toBe(
			true
		);
	});

	it('leaves pure view settings alone', () => {
		const listViewOnly = (Object.keys(DEFAULT_VIEW_SETTINGS) as (keyof ViewSettings)[]).filter(
			(key) => !listWalkFields.includes(key)
		);
		for (const key of listViewOnly) {
			const value = DEFAULT_VIEW_SETTINGS[key];
			const flipped =
				typeof value === 'boolean' ? !value : typeof value === 'number' ? value + 1 : 'changed';
			// Walk fields are covered above; anything else changing must not force a reload.
			expect(
				settingsRequireReload(DEFAULT_VIEW_SETTINGS, {
					...DEFAULT_VIEW_SETTINGS,
					[key]: flipped,
				} as ViewSettings)
			).toBe(false);
		}
	});

	it('answers false for identical settings', () => {
		expect(settingsRequireReload(DEFAULT_VIEW_SETTINGS, { ...DEFAULT_VIEW_SETTINGS })).toBe(false);
	});
});

describe('pickOption', () => {
	it('returns the member a raw value names', () => {
		expect(pickOption(LIST_GRAPH_STYLES, 'curved')).toBe('curved');
		expect(pickOption(LIST_COMMIT_ORDERS, 'topo')).toBe('topo');
	});

	it('returns nothing for a value that names no member', () => {
		// What a stale or hand-edited <option> would hand back; the setting must stay as it was.
		expect(pickOption(LIST_DIFF_TARGETS, 'sidebar')).toBeUndefined();
		expect(pickOption(LIST_DATE_TYPES, '')).toBeUndefined();
	});

	it('offers every option the settings defaults use', () => {
		expect(LIST_DIFF_TARGETS).toContain(DEFAULT_VIEW_SETTINGS.diffTarget);
		expect(LIST_GRAPH_STYLES).toContain(DEFAULT_VIEW_SETTINGS.graphStyle);
		expect(LIST_COMMIT_ORDERS).toContain(DEFAULT_VIEW_SETTINGS.commitOrder);
		expect(LIST_DATE_TYPES).toContain(DEFAULT_VIEW_SETTINGS.dateType);
	});
});
