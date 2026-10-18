import {
	chmodSync,
	cpSync,
	existsSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HELPER_SOURCE = path.resolve(__dirname, '../../../host/media/askpass');
const COPY_SCRIPT = path.resolve(__dirname, '../../scripts/copyAskpass.mjs');

describe('the askpass helper in the desktop build', () => {
	let dir = '';
	let copyAskpassHelper: (source: string, dest: string) => void;

	beforeEach(async () => {
		dir = mkdtempSync(path.join(tmpdir(), 'git-octopus-dist-'));
		const url = pathToFileURL(COPY_SCRIPT).href;
		({ copyAskpassHelper } = (await import(/* @vite-ignore */ url)) as {
			copyAskpassHelper: typeof copyAskpassHelper;
		});
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('copies both files and leaves askpass.sh executable', () => {
		const dest = path.join(dir, 'dist', 'askpass');
		copyAskpassHelper(HELPER_SOURCE, dest);
		expect(existsSync(path.join(dest, 'askpass-main.cjs'))).toBe(true);
		expect(statSync(path.join(dest, 'askpass.sh')).mode & 0o111).toBe(0o111);
	});

	it('sets the mode itself, whatever mode the source file was checked out with', () => {
		const source = path.join(dir, 'source');
		cpSync(HELPER_SOURCE, source, { recursive: true });
		chmodSync(path.join(source, 'askpass.sh'), 0o644);
		const dest = path.join(dir, 'dist', 'askpass');
		copyAskpassHelper(source, dest);
		expect(statSync(path.join(dest, 'askpass.sh')).mode & 0o777).toBe(0o755);
	});

	it('replaces what an earlier build left, without keeping files that are gone', () => {
		const dest = path.join(dir, 'dist', 'askpass');
		copyAskpassHelper(HELPER_SOURCE, dest);
		writeFileSync(path.join(dest, 'stale.txt'), 'old');
		copyAskpassHelper(HELPER_SOURCE, dest);
		expect(existsSync(path.join(dest, 'stale.txt'))).toBe(false);
		expect(existsSync(path.join(dest, 'askpass.sh'))).toBe(true);
	});
});
