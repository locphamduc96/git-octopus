import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitProcessExecutor } from './gitProcessExecutor.js';
import { setGitPathSource } from './gitProgram.js';

describe('GitProcessExecutor git path', () => {
	let dir = '';
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'git-octopus-gitpath-'));
	});
	afterEach(() => {
		setGitPathSource(() => undefined);
		rmSync(dir, { recursive: true, force: true });
	});

	it('runs the program the setting names instead of git on the PATH', async () => {
		const fake = path.join(dir, 'my git');
		writeFileSync(fake, '#!/bin/sh\necho "fake-git $@"\n');
		chmodSync(fake, 0o755);
		setGitPathSource(() => fake);
		await expect(new GitProcessExecutor().run(['status', '-s'], dir)).resolves.toBe(
			'fake-git status -s\n'
		);
	});

	it('fails with the spawn error when that path holds no program', async () => {
		setGitPathSource(() => path.join(dir, 'nowhere', 'git'));
		await expect(new GitProcessExecutor().run(['status'], dir)).rejects.toMatchObject({
			code: 'ENOENT',
		});
	});

	it('goes back to git on the PATH when the setting is emptied', async () => {
		setGitPathSource(() => '');
		await expect(new GitProcessExecutor().run(['--version'], dir)).resolves.toMatch(/^git version/);
	});
});
