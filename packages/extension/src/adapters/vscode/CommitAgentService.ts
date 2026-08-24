import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
	AgentInventoryMessage,
	CommitPlanExecutedMessage,
	CommitPlanResultMessage,
	ExecuteCommitPlanMessage,
	GenerateCommitPlanMessage,
	FileChange,
} from '@git-octopus/shared';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import { getCurrentBranch, getHeadHash, getStatus } from '../../core/git/gitService.js';
import { parseNumstat } from '../../core/git/numstatParser.js';
import { redactSecrets } from '../../core/git/redactSecrets.js';
import { classifyChanges, type ChangeEntry } from '../../core/agent/classifyChanges.js';
import { buildCommitPrompt, type PromptFile } from '../../core/agent/commitPrompt.js';
import { parseCommitPlan } from '../../core/agent/planParser.js';
import { LIST_AGENT_PROVIDERS, providerById } from '../../core/agent/agentProviders.js';
import { AgentProcessRunner, CANCELLED } from '../process/agentProcessRunner.js';

export const STATE_AI_AGENT = 'gitOctopus.aiAgent';
export const STATE_AI_CONSENT = 'gitOctopus.aiConsent';

/**
 * The AI-commit orchestrator: detects agent CLIs, turns the working tree into a prompt, runs the
 * chosen agent once, and executes an approved plan. The agent only ever produces text — every
 * `git` call in this flow is made here, through the same executor as every other action.
 */
export class CommitAgentService {
	public constructor(
		private readonly executor: GitExecutor,
		private readonly globalState: vscode.Memento,
		private readonly runner: AgentProcessRunner = new AgentProcessRunner()
	) {}

	public async detect(): Promise<AgentInventoryMessage> {
		const listAgents = await Promise.all(
			LIST_AGENT_PROVIDERS.map(async (provider) => {
				const version = await this.runner.version(provider.bin);
				return {
					id: provider.id,
					label: provider.label,
					...(version ? { version } : {}),
					state: version ? ('ready' as const) : ('missing' as const),
				};
			})
		);
		return {
			type: 'agentInventory',
			listAgents,
			savedAgentId: providerById(this.globalState.get<string>(STATE_AI_AGENT))?.id ?? null,
			consented: this.globalState.get<boolean>(STATE_AI_CONSENT, false),
		};
	}

	/** Record the pick and, with it, the user's consent to sending diffs to that agent. */
	public async select(agentId: string): Promise<void> {
		if (!providerById(agentId)) return;
		await this.globalState.update(STATE_AI_AGENT, agentId);
		await this.globalState.update(STATE_AI_CONSENT, true);
	}

	public cancel(nonce: number): void {
		this.runner.cancel(nonce);
	}

	public async generate(
		message: GenerateCommitPlanMessage,
		cwd: string
	): Promise<CommitPlanResultMessage> {
		const fail = (error: string, needsLogin?: boolean): CommitPlanResultMessage => ({
			type: 'commitPlanResult',
			nonce: message.nonce,
			error,
			...(needsLogin ? { needsLogin } : {}),
		});

		const provider = providerById(this.globalState.get<string>(STATE_AI_AGENT));
		if (!provider) return fail('No agent selected.');

		const working = await getStatus(this.executor, cwd);
		const listChanges = dedupeByPath([...working.staged, ...working.unstaged]);
		if (listChanges.length === 0) return fail('There are no changes to commit.');

		if ((await getHeadHash(this.executor, cwd)) === null) {
			return fail('The repository has no commits yet — make the first commit manually.');
		}

		const prompt = await this.buildPrompt(cwd, listChanges);

		let stdout: string;
		let stderr: string;
		let code: number | null;
		try {
			const spec = provider.runSpec();
			({ stdout, stderr, code } = await this.runner.run(
				spec.bin,
				spec.listArgs,
				cwd,
				prompt,
				message.nonce
			));
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			if (detail === CANCELLED) return fail('Cancelled.');
			return fail(redactSecrets(detail));
		}

		const combined = `${stderr}\n${stdout}`;
		if (code !== 0) {
			if (provider.needsLogin(combined)) {
				return fail(`${provider.label} is not logged in on this machine.`, true);
			}
			const detail = (stderr.trim() || stdout.trim() || `exit code ${code}`).slice(0, 400);
			return fail(`${provider.label} failed: ${redactSecrets(detail)}`);
		}
		if (provider.needsLogin(combined)) {
			return fail(`${provider.label} is not logged in on this machine.`, true);
		}

		const parsed = parseCommitPlan(
			provider.extractText(stdout),
			listChanges.map((change) => change.path)
		);
		if (parsed.error) return fail(parsed.error);
		return { type: 'commitPlanResult', nonce: message.nonce, plan: parsed.plan };
	}

	/**
	 * Create the approved commits, in order, stopping at the first failure. Never rolls back:
	 * a commit that exists is the user's, and reporting "created k of N" beats destroying work.
	 */
	public async execute(
		message: ExecuteCommitPlanMessage,
		cwd: string
	): Promise<CommitPlanExecutedMessage> {
		const total = message.listGroups.length;
		const fail = (committed: number, error: string): CommitPlanExecutedMessage => ({
			type: 'commitPlanExecuted',
			nonce: message.nonce,
			committed,
			total,
			error,
		});
		if (total === 0) return fail(0, 'The plan is empty.');
		for (const group of message.listGroups) {
			if (group.listFiles.length === 0 || group.message.trim() === '') {
				return fail(0, 'Every commit needs at least one file and a message.');
			}
		}

		// The plan was drawn over a working tree that may since have moved on. A planned file
		// that is no longer changed would make `git add` stage nothing and the commit lie.
		const working = await getStatus(this.executor, cwd);
		const setCurrent = new Set(
			[...working.staged, ...working.unstaged].map((change) => change.path)
		);
		const listGone = message.listGroups
			.flatMap((group) => group.listFiles)
			.filter((file) => !setCurrent.has(file));
		if (listGone.length > 0) {
			return fail(0, 'The working tree changed since this plan was made — generate it again.');
		}

		let committed = 0;
		try {
			await this.executor.run(['reset', '-q', 'HEAD'], cwd);
			for (const group of message.listGroups) {
				await this.executor.run(['add', '--', ...group.listFiles], cwd);
				await this.executor.run(['commit', '-m', group.message], cwd);
				committed++;
			}
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			return fail(committed, redactSecrets(detail));
		}
		return { type: 'commitPlanExecuted', nonce: message.nonce, committed, total };
	}

	private async buildPrompt(cwd: string, listChanges: FileChange[]): Promise<string> {
		const listExcludePatterns = vscode.workspace
			.getConfiguration('gitOctopus.aiCommit')
			.get<string[]>('excludePatterns', []);

		const listEntries: ChangeEntry[] = await Promise.all(
			listChanges.map(async (change) => ({
				path: change.path,
				status: change.status,
				bytes: await fileSize(path.join(cwd, change.path)),
			}))
		);
		const listClassified = classifyChanges(listEntries, listExcludePatterns);

		const mapCounts = parseNumstat(
			await this.executor.run(['diff', 'HEAD', '--numstat'], cwd).catch(() => '')
		);

		const listFiles: PromptFile[] = await Promise.all(
			listClassified.map(async (entry) => {
				const counts = mapCounts.get(entry.path);
				const file: PromptFile = {
					path: entry.path,
					status: entry.status,
					tier: entry.tier,
					...(counts ?? {}),
				};
				if (entry.tier !== 'source') return file;
				const diff =
					entry.status === '?'
						? // `--no-index` exits 1 whenever the files differ — that IS the diff.
							await this.executor
								.run(['diff', '--no-index', '--', '/dev/null', entry.path], cwd, [1])
								.catch(() => undefined)
						: await this.executor.run(['diff', 'HEAD', '--', entry.path], cwd).catch(() => undefined);
				return diff ? { ...file, diff } : file;
			})
		);

		const [branch, listRecentSubjects] = await Promise.all([
			getCurrentBranch(this.executor, cwd),
			this.executor
				.run(['log', '-n', '10', '--format=%s'], cwd)
				.then((output) => output.split('\n').filter((line) => line !== ''))
				.catch(() => [] as string[]),
		]);

		return buildCommitPrompt({ branch, listRecentSubjects, listFiles });
	}
}

function dedupeByPath(listChanges: FileChange[]): FileChange[] {
	const mapByPath = new Map<string, FileChange>();
	for (const change of listChanges) {
		if (!mapByPath.has(change.path)) mapByPath.set(change.path, change);
	}
	return [...mapByPath.values()];
}

async function fileSize(absolutePath: string): Promise<number | undefined> {
	try {
		return (await fs.stat(absolutePath)).size;
	} catch {
		return undefined;
	}
}
