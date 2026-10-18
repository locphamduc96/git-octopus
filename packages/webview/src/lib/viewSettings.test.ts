import { describe, expect, it } from 'vitest';
import {
	moveColumn,
	normalizeColumnOrder,
	DEFAULT_VIEW_SETTINGS,
	LIST_COMMIT_ORDERS,
	LIST_DATE_TYPES,
	LIST_DIFF_TARGETS,
	LIST_EXTERNAL_EDITORS,
	LIST_GRAPH_STYLES,
	LIST_PULL_STRATEGIES,
	LIST_THEME_CHOICES,
	MAP_EXTERNAL_EDITOR_LABEL,
	MAP_THEME_LABEL,
	REF_PANEL_DEFAULT_WIDTH,
	REF_PANEL_MAX_WIDTH,
	REF_PANEL_MIN_WIDTH,
	branchesPanelShown,
	clampRefPanelWidth,
	mergePreferences,
	pickOption,
	pullActionFor,
	settingsRequireReload,
	type GlobalPreferences,
	type ViewSettings,
} from './viewSettings';

function currentPreferences(): GlobalPreferences {
	return {
		settings: { ...DEFAULT_VIEW_SETTINGS },
		columns: { author: false, commit: false, date: true, changes: false },
		fileView: 'tree',
		metaOpen: false,
		listCollapsedSections: [],
	};
}

describe('terminalApp', () => {
	it('defaults to Terminal and keeps a valid stored choice', () => {
		expect(DEFAULT_VIEW_SETTINGS.terminalApp).toBe('Terminal');
		const merged = mergePreferences(currentPreferences(), { settings: { terminalApp: 'Warp' } });
		expect(merged.settings.terminalApp).toBe('Warp');
	});

	it.each([['kitty'], [42], [null], [{}], ['']])('reads %j back as Terminal', (bad) => {
		const merged = mergePreferences(currentPreferences(), { settings: { terminalApp: bad } });
		expect(merged.settings.terminalApp).toBe('Terminal');
	});
});

describe('desktop settings', () => {
	it('start on the system theme, the git on the PATH and the first installed editor', () => {
		expect(DEFAULT_VIEW_SETTINGS).toMatchObject({
			theme: 'system',
			gitPath: '',
			externalEditor: 'auto',
			externalEditorCommand: '',
		});
	});

	it('keep what was stored', () => {
		const merged = mergePreferences(currentPreferences(), {
			settings: {
				theme: 'dark',
				gitPath: '/opt/homebrew/bin/git',
				externalEditor: 'custom',
				externalEditorCommand: 'subl --wait {file}',
			},
		});
		expect(merged.settings).toMatchObject({
			theme: 'dark',
			gitPath: '/opt/homebrew/bin/git',
			externalEditor: 'custom',
			externalEditorCommand: 'subl --wait {file}',
		});
	});

	it.each([['solarized'], [42], [null], [{}], ['']])('read a theme of %j back as system', (bad) => {
		const merged = mergePreferences(currentPreferences(), { settings: { theme: bad } });
		expect(merged.settings.theme).toBe('system');
	});

	it.each([['emacs'], [42], [null], [{}], ['']])('read an editor of %j back as auto', (bad) => {
		const merged = mergePreferences(currentPreferences(), {
			settings: { externalEditor: bad },
		});
		expect(merged.settings.externalEditor).toBe('auto');
	});

	it.each([[42], [null], [{}], [['git']]])(
		'read a git path or command of %j back as empty',
		(bad) => {
			const merged = mergePreferences(currentPreferences(), {
				settings: { gitPath: bad, externalEditorCommand: bad },
			});
			expect(merged.settings.gitPath).toBe('');
			expect(merged.settings.externalEditorCommand).toBe('');
		}
	);

	it('list every theme and every editor the settings offer, each with a label', () => {
		expect(LIST_THEME_CHOICES.map((theme) => MAP_THEME_LABEL[theme])).toEqual([
			'System',
			'Light',
			'Dark',
		]);
		expect(LIST_EXTERNAL_EDITORS.map((editor) => MAP_EXTERNAL_EDITOR_LABEL[editor])).toEqual([
			'Automatic',
			'VS Code',
			'Cursor',
			'Zed',
			'Sublime Text',
			'Custom command',
		]);
	});
});

describe('showBranchesPanel', () => {
	it('is unset by default, so the shell decides: desktop shows the panel, the extension hides it', () => {
		expect(DEFAULT_VIEW_SETTINGS.showBranchesPanel).toBeNull();
		expect(branchesPanelShown(DEFAULT_VIEW_SETTINGS, true)).toBe(true);
		expect(branchesPanelShown(DEFAULT_VIEW_SETTINGS, false)).toBe(false);
	});

	it('lets an explicit choice win in both shells', () => {
		const off: ViewSettings = { ...DEFAULT_VIEW_SETTINGS, showBranchesPanel: false };
		const on: ViewSettings = { ...DEFAULT_VIEW_SETTINGS, showBranchesPanel: true };
		expect(branchesPanelShown(off, true)).toBe(false);
		expect(branchesPanelShown(on, false)).toBe(true);
	});

	it('keeps a stored choice and leaves it unset for a blob that predates the setting', () => {
		const chosen = mergePreferences(currentPreferences(), {
			settings: { showBranchesPanel: false },
		});
		expect(chosen.settings.showBranchesPanel).toBe(false);
		const older = mergePreferences(currentPreferences(), { settings: { commitLimit: 100 } });
		expect(older.settings.showBranchesPanel).toBeNull();
	});
});

describe('clampRefPanelWidth', () => {
	it('clamps a width into the allowed range and ignores garbage', () => {
		expect(clampRefPanelWidth(9000)).toBe(REF_PANEL_MAX_WIDTH);
		expect(clampRefPanelWidth(3)).toBe(REF_PANEL_MIN_WIDTH);
		expect(clampRefPanelWidth('wide')).toBe(REF_PANEL_DEFAULT_WIDTH);
		expect(clampRefPanelWidth(undefined)).toBe(REF_PANEL_DEFAULT_WIDTH);
		expect(clampRefPanelWidth(300.4)).toBe(300);
	});
});

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
		expect(merged.columns).toEqual({ author: true, commit: false, date: true, changes: false });
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

	it('keeps the folded working-tree groups it knows, and drops anything else', () => {
		const merged = mergePreferences(currentPreferences(), {
			listCollapsedSections: ['staged', 'nonsense', 3, 'untracked'],
		});
		expect(merged.listCollapsedSections).toEqual(['staged', 'untracked']);
	});

	it('keeps the current folds when the blob has no list there', () => {
		const merged = mergePreferences(currentPreferences(), { listCollapsedSections: 'staged' });
		expect(merged.listCollapsedSections).toEqual([]);
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
		'showSignatures',
		'gitPath',
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
		expect(settingsRequireReload(DEFAULT_VIEW_SETTINGS, changed('gitPath', '/opt/git'))).toBe(true);
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

describe('pullActionFor', () => {
	it('sends a plain pull for the default, so nothing changes for anyone who never chose', () => {
		expect(pullActionFor('config')).toBe('pull');
	});

	it('states every other strategy on the command line', () => {
		// A repository's `pull.ff false` must not turn the chosen fast-forward into a merge commit.
		expect(pullActionFor('ff')).toBe('pullFfIfPossible');
		expect(pullActionFor('ffOnly')).toBe('pullFf');
		expect(pullActionFor('rebase')).toBe('pullRebase');
	});

	it('names an action for every listed strategy', () => {
		for (const strategy of LIST_PULL_STRATEGIES) expect(pullActionFor(strategy)).toBeTruthy();
	});
});

describe('column order', () => {
	it('keeps a valid order, drops junk and repeats, and adds what is missing', () => {
		expect(normalizeColumnOrder(['date', 'author', 'commit', 'changes'])).toEqual([
			'date',
			'author',
			'commit',
			'changes',
		]);
		// An order saved before the Changes column existed gets it at the end.
		expect(normalizeColumnOrder(['date', 'author', 'commit'])).toEqual([
			'date',
			'author',
			'commit',
			'changes',
		]);
		expect(normalizeColumnOrder(['date', 'date', 'bogus'])).toEqual([
			'date',
			'author',
			'commit',
			'changes',
		]);
		expect(normalizeColumnOrder(undefined)).toEqual(['author', 'commit', 'date', 'changes']);
	});

	it('moves a column to where another stands, in either direction', () => {
		expect(moveColumn(['author', 'commit', 'date'], 'author', 'date')).toEqual([
			'commit',
			'date',
			'author',
		]);
		expect(moveColumn(['author', 'commit', 'date'], 'date', 'author')).toEqual([
			'date',
			'author',
			'commit',
		]);
		expect(moveColumn(['author', 'commit', 'date'], 'commit', 'commit')).toEqual([
			'author',
			'commit',
			'date',
		]);
	});
});
