import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STATE_VIEW_SETTINGS } from '@git-octopus/host/adapters/services/GitOctopusController';
import { parseThemeSource, readStoredThemeSource, VIEW_SETTINGS_KEY } from './themeSource.js';

describe('themeSource', () => {
	let dir = '';
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'git-octopus-theme-'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('uses the key the controller stores the view settings under', () => {
		expect(VIEW_SETTINGS_KEY).toBe(STATE_VIEW_SETTINGS);
	});

	it('accepts the three sources and falls back to the system for anything else', () => {
		expect(['system', 'light', 'dark'].map(parseThemeSource)).toEqual(['system', 'light', 'dark']);
		expect([undefined, null, '', 'Dark', 3].map(parseThemeSource)).toEqual(Array(5).fill('system'));
	});

	it('reads the saved choice out of the state file', () => {
		const file = path.join(dir, 'state.json');
		writeFileSync(file, JSON.stringify({ [VIEW_SETTINGS_KEY]: { settings: { theme: 'dark' } } }));
		expect(readStoredThemeSource(file)).toBe('dark');
	});

	it('follows the system when there is no file, no settings or nonsense', () => {
		expect(readStoredThemeSource(path.join(dir, 'missing.json'))).toBe('system');
		const file = path.join(dir, 'state.json');
		writeFileSync(file, JSON.stringify({ other: 1 }));
		expect(readStoredThemeSource(file)).toBe('system');
		writeFileSync(file, 'not json');
		expect(readStoredThemeSource(file)).toBe('system');
	});
});
