import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	isExistingFolder,
	readAppState,
	withRecent,
	withoutMissing,
	withoutRecent,
	writeAppState,
} from './appState.js';

describe('recent repositories', () => {
	it('adds a folder to the top', () => {
		expect(withRecent(['/a', '/b'], '/c')).toEqual(['/c', '/a', '/b']);
		expect(withRecent([], '/a')).toEqual(['/a']);
	});

	it('moves a reopened folder to the top without a duplicate', () => {
		expect(withRecent(['/a', '/b', '/c'], '/c')).toEqual(['/c', '/a', '/b']);
		expect(withRecent(['/a', '/b'], '/a')).toEqual(['/a', '/b']);
	});

	it('keeps only the ten newest', () => {
		const listFolders = Array.from({ length: 12 }, (_, i) => `/repo-${i}`);
		const listRecent = listFolders.reduce<string[]>((list, folder) => withRecent(list, folder), []);
		expect(listRecent).toHaveLength(10);
		expect(listRecent[0]).toBe('/repo-11');
		expect(listRecent.at(-1)).toBe('/repo-2');
	});

	it('removes one folder and leaves the order of the rest', () => {
		expect(withoutRecent(['/a', '/b', '/c'], '/b')).toEqual(['/a', '/c']);
		expect(withoutRecent(['/a'], '/z')).toEqual(['/a']);
	});

	it('drops the folders the check says are gone', () => {
		const listKept = withoutMissing(['/a', '/gone', '/b'], (folder) => folder !== '/gone');
		expect(listKept).toEqual(['/a', '/b']);
	});
});

describe('recent folders on disk', () => {
	let root = '';
	beforeEach(() => {
		root = mkdtempSync(path.join(os.tmpdir(), 'git-octopus-recent-'));
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it('drops a folder that no longer exists, and a path that is a file', () => {
		const present = path.join(root, 'present');
		const removed = path.join(root, 'removed');
		const file = path.join(root, 'file.txt');
		mkdirSync(present);
		mkdirSync(removed);
		writeFileSync(file, 'x');
		rmSync(removed, { recursive: true });
		expect(isExistingFolder(present)).toBe(true);
		expect(withoutMissing([removed, present, file])).toEqual([present]);
	});

	it('round-trips through the state file', () => {
		const file = path.join(root, 'app.json');
		writeAppState(file, { listRecent: ['/a', '/b'], listOpen: ['/a'], activeIndex: 0 });
		expect(readAppState(file)).toMatchObject({ listRecent: ['/a', '/b'], listOpen: ['/a'] });
		expect(readAppState(path.join(root, 'missing.json'))).toEqual({ listRecent: [], listOpen: [] });
	});
});
