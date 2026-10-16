import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommitAgentService, STATE_AI_AGENT, STATE_AI_CONSENT } from './CommitAgentService.js';
import { mapConfig, recorded, resetRecorded, testShell } from '../../test/fakeShell.js';
import { createTempRepo } from '../../test/tempRepo.js';
import { GitProcessExecutor } from '../process/gitProcessExecutor.js';
import { FakeGit } from '../../test/fakeGit.js';
import type { AgentProcessRunner, AgentRunResult } from '../process/agentProcessRunner.js';

const CWD = '/repo';

/** porcelain v2: `1 <XY> …` per tracked change. All three are staged (`M.`). */
const STATUS = [
	'1 M. N... 100644 100644 100644 aaa bbb src/a.ts',
	'1 M. N... 100644 100644 100644 aaa bbb src/b.ts',
	'1 M. N... 100644 100644 100644 aaa bbb assets/sprite.png',
	'',
].join('\0');

const DIFF_A = [
	'diff --git a/src/a.ts b/src/a.ts',
	'index 111..222 100644',
	'--- a/src/a.ts',
	'+++ b/src/a.ts',
	'@@ -1 +1 @@',
	'-old a',
	'+new a',
].join('\n');

const DIFF_B = [
	'diff --git a/src/b.ts b/src/b.ts',
	'index 333..444 100644',
	'--- a/src/b.ts',
	'+++ b/src/b.ts',
	'@@ -1 +1 @@',
	'-old b',
	'+new b',
].join('\n');

const PLAN_JSON = JSON.stringify({
	result: JSON.stringify({
		groups: [{ files: ['src/a.ts', 'src/b.ts', 'assets/sprite.png'], subject: 'feat: x' }],
		single: { subject: 'feat: x' },
	}),
});

function makeGit(overrides: Record<string, string> = {}): FakeGit {
	return new FakeGit({
		status: STATUS,
		'rev-parse HEAD': 'headhash\n',
		'rev-parse --abbrev-ref HEAD': 'main\n',
		'log -n 10': 'previous subject\n',
		'-c core.quotePath=false diff-index --numstat -M HEAD': '1\t1\tsrc/a.ts\n1\t1\tsrc/b.ts\n',
		'-c core.quotePath=false diff-index -p --no-renames HEAD': `${DIFF_A}\n${DIFF_B}`,
		...overrides,
	});
}

/** An agent CLI that is installed and answers with one fixed plan. */
function makeRunner(): AgentProcessRunner {
	return {
		version: () => Promise.resolve('1.0.0'),
		run: (): Promise<AgentRunResult> => Promise.resolve({ stdout: PLAN_JSON, stderr: '', code: 0 }),
		cancel: () => undefined,
	} as unknown as AgentProcessRunner;
}

function makeState(): {
	get: (key: string, fallback?: unknown) => unknown;
	update: () => Promise<void>;
} {
	const mapState = new Map<string, unknown>([
		[STATE_AI_AGENT, 'claude'],
		[STATE_AI_CONSENT, true],
	]);
	return {
		get: (key, fallback) => mapState.get(key) ?? fallback,
		update: () => Promise.resolve(),
	};
}

function makeService(git: FakeGit): CommitAgentService {
	return new CommitAgentService(
		git,
		testShell,
		makeState() as unknown as ConstructorParameters<typeof CommitAgentService>[2],
		makeRunner()
	);
}

async function generate(git: FakeGit): Promise<void> {
	await makeService(git).generate({ type: 'generateCommitPlan', repoPath: CWD }, CWD);
}

/** Every `git diff` the service ran, as joined argv. */
function diffCalls(git: FakeGit): string[] {
	return git.listCalls.filter((args) => args.includes('diff-index')).map((args) => args.join(' '));
}

describe('CommitAgentService diff reads', () => {
	beforeEach(() => {
		resetRecorded();
		mapConfig.clear();
	});

	it('reads every source diff in one command instead of one per file', async () => {
		const git = makeGit();

		await generate(git);

		const listBatched = diffCalls(git).filter((argv) => argv.includes('--no-renames'));
		expect(listBatched).toHaveLength(1);
		expect(listBatched[0]).toContain('src/a.ts');
		expect(listBatched[0]).toContain('src/b.ts');
	});

	it('reads diffs and line counts with plumbing only — porcelain diff would rewrite the index', async () => {
		const git = makeGit();

		await generate(git);

		expect(git.listCalls.some((args) => args.includes('diff'))).toBe(false);
		expect(diffCalls(git).length).toBeGreaterThanOrEqual(2);
	});

	it('never asks for the diff of a file the agent will not be shown', async () => {
		const git = makeGit();

		await generate(git);

		// `assets/sprite.png` classifies as an asset, so its content must not be read at all —
		// excludePatterns and the tier split are about what leaves the machine, not just what prints.
		expect(diffCalls(git).some((argv) => argv.includes('sprite.png'))).toBe(false);
	});

	it('keeps non-ASCII paths literal so the line counts can be looked up', async () => {
		const git = makeGit();

		await generate(git);

		// Without core.quotePath=false git writes `"h\303\251llo.ts"` and every map lookup misses.
		const numstat = git.listCalls.find((args) => args.includes('--numstat'));
		expect(numstat?.slice(0, 2)).toEqual(['-c', 'core.quotePath=false']);
	});

	it('falls back to one file at a time when the batched read fails', async () => {
		// A single generated file can blow the executor's 64 MB cap and take the whole command with
		// it; the per-file retry means that costs one file's diff, not every file's.
		const git = makeGit({
			'-c core.quotePath=false diff-index -p --no-renames HEAD -- src/a.ts': DIFF_A,
			'-c core.quotePath=false diff-index -p --no-renames HEAD -- src/b.ts': DIFF_B,
		});
		git.rejectOn(
			'-c core.quotePath=false diff-index -p --no-renames HEAD -- src/a.ts src/b.ts',
			'too big'
		);

		await generate(git);

		const listPerFile = diffCalls(git).filter(
			(argv) => argv.includes('--no-renames') && !argv.includes('src/a.ts src/b.ts')
		);
		expect(listPerFile).toHaveLength(2);
	});

	it('asks git nothing about diffs when no source file is staged', async () => {
		const git = makeGit({
			status: ['1 M. N... 100644 100644 100644 aaa bbb assets/sprite.png', ''].join('\0'),
			'-c core.quotePath=false diff-index -p --no-renames HEAD': '',
		});

		await generate(git);

		expect(diffCalls(git).some((argv) => argv.includes('--no-renames'))).toBe(false);
	});
});

describe('CommitAgentService agent process', () => {
	beforeEach(() => {
		resetRecorded();
		mapConfig.clear();
	});

	it('runs the agent in its own empty folder, never inside the repository', async () => {
		// An agent started in the repository can run git there by itself and hold the index lock;
		// the prompt already carries every diff it is allowed to see.
		const workdir = path.join(await mkdtemp(path.join(tmpdir(), 'git-octopus-agent-test-')), 'w');
		const listCwds: string[] = [];
		const runner = {
			...makeRunner(),
			run: (_bin: string, _args: string[], cwd: string): Promise<AgentRunResult> => {
				listCwds.push(cwd);
				return Promise.resolve({ stdout: PLAN_JSON, stderr: '', code: 0 });
			},
		} as unknown as AgentProcessRunner;
		const service = new CommitAgentService(
			makeGit(),
			testShell,
			makeState() as unknown as ConstructorParameters<typeof CommitAgentService>[2],
			runner,
			workdir
		);

		await service.generate({ type: 'generateCommitPlan', repoPath: CWD }, CWD);

		expect(listCwds).toEqual([workdir]);
		expect((await stat(workdir)).isDirectory()).toBe(true);
		await rm(path.dirname(workdir), { recursive: true, force: true });
	});
});

describe('CommitAgentService.explain', () => {
	beforeEach(() => {
		resetRecorded();
	});

	it('hands the commit to the agent and opens its answer as a Markdown document', async () => {
		const repo = await createTempRepo();
		try {
			const hash = await repo.commit('a.txt', 'a\n', 'feat: add a');
			const listPrompts: string[] = [];
			const runner = {
				version: () => Promise.resolve('1.0.0'),
				run: (_bin: string, _args: string[], _cwd: string, stdin: string) => {
					listPrompts.push(stdin);
					return Promise.resolve({
						stdout: JSON.stringify({ result: '## Summary\nAdds a.' }),
						stderr: '',
						code: 0,
					});
				},
				cancel: () => undefined,
			} as unknown as AgentProcessRunner;
			const workdir = await mkdtemp(path.join(tmpdir(), 'git-octopus-explain-'));
			const service = new CommitAgentService(
				new GitProcessExecutor(),
				testShell,
				makeState() as unknown as ConstructorParameters<typeof CommitAgentService>[2],
				runner,
				workdir
			);
			await service.explain(
				{ type: 'aiExplain', repoPath: repo.cwd, target: { kind: 'commit', hash } },
				repo.cwd
			);
			await rm(workdir, { recursive: true, force: true });
			expect(listPrompts[0]).toContain('feat: add a');
			expect(listPrompts[0]).toContain('+a');
			expect(recorded.listDocuments).toHaveLength(1);
			expect(recorded.listDocuments[0].language).toBe('markdown');
			expect(recorded.listDocuments[0].content).toContain('## Summary\nAdds a.');
			expect(recorded.listErrors).toEqual([]);
		} finally {
			await repo.dispose();
		}
	});

	it('asks for an agent first when none was chosen', async () => {
		const service = new CommitAgentService(
			new FakeGit({}),
			testShell,
			{
				get: (_key: string, fallback?: unknown) => fallback,
				update: () => Promise.resolve(),
			} as unknown as ConstructorParameters<typeof CommitAgentService>[2],
			makeRunner()
		);
		await service.explain({ type: 'aiExplain', repoPath: CWD, target: { kind: 'working' } }, CWD);
		expect(recorded.listErrors[0]).toContain('choose an agent CLI');
		expect(recorded.listDocuments).toEqual([]);
	});
});
