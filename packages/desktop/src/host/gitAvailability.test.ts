import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitExecutor } from '@git-octopus/host/core/git/GitExecutor';
import { GitProcessExecutor } from '@git-octopus/host/adapters/process/gitProcessExecutor';
import { setGitPathSource } from '@git-octopus/host/adapters/process/gitProgram';
import { describeGitFailure, GitAvailabilityExecutor } from './gitAvailability.js';

function startError(code: string, program = 'git'): NodeJS.ErrnoException {
	return Object.assign(new Error(`spawn ${program} ${code}`), {
		code,
		syscall: `spawn ${program}`,
		errno: -2,
	});
}

function setup(inner: GitExecutor, program = 'git') {
	const listSaid: string[] = [];
	const executor = new GitAvailabilityExecutor(inner, {
		program: () => program,
		onUnavailable: (message) => listSaid.push(message),
		directoryExists: () => true,
	});
	return { executor, listSaid };
}

describe('describeGitFailure', () => {
	it('names the PATH when the setting is empty', () => {
		expect(describeGitFailure('git', 'ENOENT')).toBe(
			'Git Octopus: git was not found on your PATH (ENOENT). Set the Git path in Settings → General → Desktop, or install git.'
		);
	});

	it('names the exact path that was tried and what was wrong with it', () => {
		expect(describeGitFailure('/opt/nowhere/git', 'ENOENT')).toContain(
			'cannot run git at /opt/nowhere/git — no such file (ENOENT)'
		);
		expect(describeGitFailure('/usr/share/doc', 'EACCES')).toContain(
			'cannot run git at /usr/share/doc — it is not an executable you may run (EACCES)'
		);
	});
});

describe('GitAvailabilityExecutor', () => {
	it('throws one clear message naming the path and says it in the view', async () => {
		const { executor, listSaid } = setup(
			{ run: () => Promise.reject(startError('ENOENT', '/opt/nowhere/git')) },
			'/opt/nowhere/git'
		);
		await expect(executor.run(['status'], '/work/repo')).rejects.toThrow(
			/cannot run git at \/opt\/nowhere\/git — no such file \(ENOENT\)/
		);
		expect(listSaid).toHaveLength(1);
		expect(listSaid[0]).toContain('/opt/nowhere/git');
	});

	it('says it once for the same path, however many commands fail', async () => {
		const { executor, listSaid } = setup({ run: () => Promise.reject(startError('ENOENT')) });
		await Promise.allSettled([
			executor.run(['status'], '/work/repo'),
			executor.run(['log'], '/work/repo'),
			executor.run(['fetch'], '/work/repo'),
		]);
		expect(listSaid).toHaveLength(1);
	});

	it('says it again once git has run in between', async () => {
		let works = false;
		const inner: GitExecutor = {
			run: () => (works ? Promise.resolve('ok') : Promise.reject(startError('ENOENT'))),
		};
		const { executor, listSaid } = setup(inner);
		await expect(executor.run(['status'], '/work/repo')).rejects.toThrow();
		works = true;
		await expect(executor.run(['status'], '/work/repo')).resolves.toBe('ok');
		works = false;
		await expect(executor.run(['status'], '/work/repo')).rejects.toThrow();
		expect(listSaid).toHaveLength(2);
	});

	it('says it again when the path changes to another that fails', async () => {
		let program = '/one/git';
		const listSaid: string[] = [];
		const executor = new GitAvailabilityExecutor(
			{ run: () => Promise.reject(startError('ENOENT')) },
			{
				program: () => program,
				onUnavailable: (message) => listSaid.push(message),
				directoryExists: () => true,
			}
		);
		await expect(executor.run(['status'], '/work/repo')).rejects.toThrow();
		program = '/two/git';
		await expect(executor.run(['status'], '/work/repo')).rejects.toThrow();
		expect(listSaid.map((message) => message.includes('/one/git'))).toEqual([true, false]);
		expect(listSaid[1]).toContain('/two/git');
	});

	it('leaves a git that ran and refused alone', async () => {
		const refusal = new Error('fatal: not a git repository');
		const { executor, listSaid } = setup({ run: () => Promise.reject(refusal) });
		await expect(executor.run(['status'], '/work/repo')).rejects.toBe(refusal);
		expect(listSaid).toEqual([]);
	});

	it('does not blame git when the working directory is what is missing', async () => {
		const error = startError('ENOENT');
		const listSaid: string[] = [];
		const executor = new GitAvailabilityExecutor(
			{ run: () => Promise.reject(error) },
			{
				program: () => 'git',
				onUnavailable: (message) => listSaid.push(message),
				directoryExists: () => false,
			}
		);
		await expect(executor.run(['status'], '/gone')).rejects.toBe(error);
		expect(listSaid).toEqual([]);
	});

	it('verifies git without running a repository command', async () => {
		const listCalls: string[][] = [];
		const { executor } = setup({
			run: (args) => {
				listCalls.push(args);
				return Promise.resolve('git version 2.50.0');
			},
		});
		await expect(executor.verify('/work')).resolves.toBe(true);
		expect(listCalls).toEqual([['--version']]);
	});
});

describe('GitAvailabilityExecutor over the real executor', () => {
	let dir = '';
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'git-octopus-avail-'));
	});
	afterEach(() => {
		setGitPathSource(() => undefined);
		rmSync(dir, { recursive: true, force: true });
	});

	it('reports a git path that does not exist, naming it', async () => {
		const missing = path.join(dir, 'no-git-here');
		setGitPathSource(() => missing);
		const listSaid: string[] = [];
		const executor = new GitAvailabilityExecutor(new GitProcessExecutor(), {
			program: () => missing,
			onUnavailable: (message) => listSaid.push(message),
		});
		await expect(executor.verify(dir)).resolves.toBe(false);
		expect(listSaid).toHaveLength(1);
		expect(listSaid[0]).toContain(missing);
	});

	it('is silent when git runs', async () => {
		const listSaid: string[] = [];
		const executor = new GitAvailabilityExecutor(new GitProcessExecutor(), {
			program: () => 'git',
			onUnavailable: (message) => listSaid.push(message),
		});
		await expect(executor.verify(dir)).resolves.toBe(true);
		expect(listSaid).toEqual([]);
	});
});
