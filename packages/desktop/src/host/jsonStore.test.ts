import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonStore, scoped } from './jsonStore.js';

describe('JsonStore', () => {
	let dir = '';
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'git-octopus-store-'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('reads back what it wrote, and answers the fallback for what it never had', async () => {
		const store = new JsonStore(path.join(dir, 'settings.json'));
		await store.update('identities', [{ label: 'Work' }]);
		expect(store.get('identities')).toEqual([{ label: 'Work' }]);
		expect(store.get('autoRefresh', true)).toBe(true);
		store.dispose();
	});

	it('keeps both of two windows writing different keys to one file', async () => {
		const file = path.join(dir, 'state.json');
		const first = new JsonStore(file);
		const second = new JsonStore(file);
		await first.update('a', 1);
		await second.update('b', 2);
		expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 1, b: 2 });
		expect(new JsonStore(file).get('a')).toBe(1);
		first.dispose();
		second.dispose();
	});

	it('scopes one folder’s keys away from another’s', async () => {
		const store = new JsonStore(path.join(dir, 'folders.json'));
		await scoped(store, '/repo/a').update('gitOctopus.activeRepo', '/repo/a');
		expect(scoped(store, '/repo/a').get('gitOctopus.activeRepo')).toBe('/repo/a');
		expect(scoped(store, '/repo/b').get('gitOctopus.activeRepo', null)).toBeNull();
		store.dispose();
	});

	it('starts empty on a file that is missing or not JSON', () => {
		expect(new JsonStore(path.join(dir, 'nothing.json')).get('x', 'fallback')).toBe('fallback');
	});
});
