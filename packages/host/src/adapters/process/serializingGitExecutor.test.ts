import { describe, expect, it } from 'vitest';
import { SerializingGitExecutor } from './serializingGitExecutor';
import type { GitExecutor } from '../../core/git/GitExecutor.js';

/** A git whose every call stays pending until the test releases it by argv label. */
class GatedGit implements GitExecutor {
	public readonly listStarted: string[] = [];
	private readonly mapRelease = new Map<string, (value: string) => void>();
	private readonly mapReject = new Map<string, (reason: Error) => void>();

	public run(args: string[], cwd: string): Promise<string> {
		const label = `${cwd}:${args.join(' ')}`;
		this.listStarted.push(label);
		return new Promise((resolve, reject) => {
			this.mapRelease.set(label, resolve);
			this.mapReject.set(label, reject);
		});
	}

	public finish(label: string, value = ''): Promise<void> {
		this.mapRelease.get(label)?.(value);
		return settle();
	}

	public fail(label: string, message = 'boom'): Promise<void> {
		this.mapReject.get(label)?.(new Error(message));
		return settle();
	}
}

/** Let every already-resolved promise in the chain run. */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SerializingGitExecutor', () => {
	it('runs one index-writing command at a time per repository', async () => {
		const inner = new GatedGit();
		const executor = new SerializingGitExecutor(inner);

		const first = executor.run(['add', '-A'], '/repo');
		const second = executor.run(['commit', '-m', 'x'], '/repo');
		await settle();

		expect(inner.listStarted).toEqual(['/repo:add -A']);

		await inner.finish('/repo:add -A');
		expect(inner.listStarted).toEqual(['/repo:add -A', '/repo:commit -m x']);

		await inner.finish('/repo:commit -m x');
		await expect(first).resolves.toBe('');
		await expect(second).resolves.toBe('');
	});

	it('keeps separate repositories independent', async () => {
		const inner = new GatedGit();
		const executor = new SerializingGitExecutor(inner);

		void executor.run(['add', '-A'], '/one');
		void executor.run(['add', '-A'], '/two');
		await settle();

		expect(inner.listStarted).toEqual(['/one:add -A', '/two:add -A']);
	});

	it('never makes a read wait behind a write', async () => {
		const inner = new GatedGit();
		const executor = new SerializingGitExecutor(inner);

		void executor.run(['add', '-A'], '/repo');
		void executor.run(['status', '--porcelain=v2'], '/repo');
		void executor.run(['log', '-n', '1'], '/repo');
		await settle();

		// A read cannot fail on a held lock, so making it queue would only slow the refresh down:
		// all three are in flight while the write is still unfinished.
		expect(new Set(inner.listStarted)).toEqual(
			new Set(['/repo:add -A', '/repo:status --porcelain=v2', '/repo:log -n 1'])
		);

		// And a second write does wait, so the reads getting through is not just "nothing queues".
		void executor.run(['commit', '-m', 'x'], '/repo');
		await settle();
		expect(inner.listStarted).not.toContain('/repo:commit -m x');
	});

	it('lets the queue continue after a command fails, and still rejects its own caller', async () => {
		const inner = new GatedGit();
		const executor = new SerializingGitExecutor(inner);

		const first = executor.run(['add', '-A'], '/repo');
		const second = executor.run(['commit', '-m', 'x'], '/repo');
		const listErrors: string[] = [];
		void first.catch((error: Error) => listErrors.push(error.message));
		await settle();

		await inner.fail('/repo:add -A', 'index.lock held');

		expect(listErrors).toEqual(['index.lock held']);
		expect(inner.listStarted).toContain('/repo:commit -m x');

		await inner.finish('/repo:commit -m x');
		await expect(second).resolves.toBe('');
	});

	it('forgets a repository once its queue drains', async () => {
		const inner = new GatedGit();
		const executor = new SerializingGitExecutor(inner);

		const only = executor.run(['add', '-A'], '/repo');
		await settle();
		await inner.finish('/repo:add -A');
		await only;
		await settle();

		// The next write starts immediately rather than chaining onto a dead tail.
		void executor.run(['commit', '-m', 'x'], '/repo');
		await settle();
		expect(inner.listStarted).toEqual(['/repo:add -A', '/repo:commit -m x']);
	});
});
