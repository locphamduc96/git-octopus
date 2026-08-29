import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
	AgentId,
	AgentInventoryMessage,
	CommitPlanExecutedMessage,
	CommitPlanProgress,
	CommitPlanProgressMessage,
	CommitPlanResultMessage,
	CommitPlanStateMessage,
	ExecuteCommitPlanMessage,
	GenerateCommitPlanMessage,
	SaveAiSettingsMessage,
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
import { PlanCache, type PlanResult } from '../../core/agent/planCache.js';
import { AgentProcessRunner, CANCELLED } from '../process/agentProcessRunner.js';

export const STATE_AI_AGENT = 'gitOctopus.aiAgent';
/** The agents whose CLI has an effort/thinking flag, and thus a declared `*Thinking` setting. */
const SET_THINKING_AGENTS = new Set<string>(['claude', 'codex']);
export const STATE_AI_CONSENT = 'gitOctopus.aiConsent';

/**
 * The AI-commit orchestrator: detects agent CLIs, turns the staged changes into a prompt, runs the
 * chosen agent once, and executes an approved plan. The agent only ever produces text — every
 * `git` call in this flow is made here, through the same executor as every other action.
 *
 * Generation state lives here, not in the webview: the run and its outcome are cached per
 * repository (see {@link PlanCache}), so a view destroyed mid-run — or one that never saw the
 * run start — can ask for `commitPlanState` and catch up.
 */
export class CommitAgentService {
	private readonly cache = new PlanCache();

	public constructor(
		private readonly executor: GitExecutor,
		private readonly globalState: vscode.Memento,
		private readonly runner: AgentProcessRunner = new AgentProcessRunner()
	) {}

	private aiConfig(): vscode.WorkspaceConfiguration {
		return vscode.workspace.getConfiguration('gitOctopus.aiCommit');
	}

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
		const config = this.aiConfig();
		const readByAgent = (suffix: string): Partial<Record<AgentId, string>> =>
			Object.fromEntries(
				LIST_AGENT_PROVIDERS.map((provider) => [
					provider.id,
					config.get<string>(`${provider.id}${suffix}`, ''),
				])
			);
		return {
			type: 'agentInventory',
			listAgents,
			savedAgentId: providerById(this.globalState.get<string>(STATE_AI_AGENT))?.id ?? null,
			consented: this.globalState.get<boolean>(STATE_AI_CONSENT, false),
			mapModels: readByAgent('Model'),
			mapThinking: readByAgent('Thinking'),
			language: config.get<string>('language', ''),
		};
	}

	/** The settings tab's save: write the preference keys, and switch agent when asked to. */
	public async saveSettings(message: SaveAiSettingsMessage): Promise<void> {
		const config = this.aiConfig();
		for (const provider of LIST_AGENT_PROVIDERS) {
			const model = message.mapModels[provider.id];
			if (model !== undefined) {
				await config.update(`${provider.id}Model`, model.trim(), vscode.ConfigurationTarget.Global);
			}
			const thinking = message.mapThinking[provider.id];
			// Only agents with a declared *Thinking setting — an undeclared key refuses the update.
			if (thinking !== undefined && SET_THINKING_AGENTS.has(provider.id)) {
				await config.update(
					`${provider.id}Thinking`,
					thinking,
					vscode.ConfigurationTarget.Global
				);
			}
		}
		if (message.language !== undefined) {
			await config.update('language', message.language.trim(), vscode.ConfigurationTarget.Global);
		}
		if (message.agentId) await this.select(message.agentId);
	}

	/** Record the pick and, with it, the user's consent to sending diffs to that agent. */
	public async select(agentId: string): Promise<void> {
		if (!providerById(agentId)) return;
		await this.globalState.update(STATE_AI_AGENT, agentId);
		await this.globalState.update(STATE_AI_CONSENT, true);
	}

	/** What the host holds for this repository — a fresh webview's first question. */
	public state(repoPath: string): CommitPlanStateMessage {
		const entry = this.cache.get(repoPath);
		if (!entry) return { type: 'commitPlanState', repoPath, status: 'idle' };
		return {
			type: 'commitPlanState',
			repoPath,
			status: entry.status,
			generationId: entry.generationId,
			...(entry.status === 'running' && entry.progress ? { progress: entry.progress } : {}),
			...(entry.result ?? {}),
		};
	}

	/** Kill the run in flight for this repository, if any. */
	public cancel(repoPath: string): void {
		const running = this.cache.runningId(repoPath);
		if (running !== null) this.runner.cancel(running);
	}

	public async generate(
		message: GenerateCommitPlanMessage,
		cwd: string,
		onProgress?: (message: CommitPlanProgressMessage) => void
	): Promise<CommitPlanResultMessage> {
		// Asking again supersedes the run in flight: its answer would only be noise now.
		this.cancel(message.repoPath);
		const generationId = this.cache.begin(message.repoPath);

		const report = (progress: CommitPlanProgress): void => {
			// Cached first: a view that arrives between broadcast and result still catches up.
			if (this.cache.progress(message.repoPath, generationId, progress)) {
				onProgress?.({
					type: 'commitPlanProgress',
					repoPath: message.repoPath,
					generationId,
					progress,
				});
			}
		};
		const result = await this.runGeneration(cwd, generationId, report);
		if (result === 'cancelled') {
			// Nothing worth replaying: a rehydrating view should see idle, not a dead run.
			this.cache.clear(message.repoPath, generationId);
			return { type: 'commitPlanResult', repoPath: message.repoPath, generationId, error: 'Cancelled.' };
		}
		this.cache.complete(message.repoPath, generationId, result);
		return { type: 'commitPlanResult', repoPath: message.repoPath, generationId, ...result };
	}

	private async runGeneration(
		cwd: string,
		generationId: number,
		report: (progress: CommitPlanProgress) => void
	): Promise<PlanResult | 'cancelled'> {
		const provider = providerById(this.globalState.get<string>(STATE_AI_AGENT));
		if (!provider) return { error: 'No agent selected.' };

		const working = await getStatus(this.executor, cwd);
		const listChanges = dedupeByPath(working.staged);
		if (listChanges.length === 0) return { error: 'There are no staged changes to commit.' };

		if ((await getHeadHash(this.executor, cwd)) === null) {
			return { error: 'The repository has no commits yet — make the first commit manually.' };
		}
		report({ stage: 'collected', fileCount: listChanges.length });

		const { prompt, additions, deletions } = await this.buildPrompt(cwd, listChanges);
		report({ stage: 'prompted', fileCount: listChanges.length, additions, deletions });

		let stdout: string;
		let stderr: string;
		let code: number | null;
		try {
			// The user's own CLI default may be an expensive model; these pins are how they cap it.
			const config = this.aiConfig();
			const model = config.get<string>(`${provider.id}Model`, '').trim();
			const thinking = config.get<string>(`${provider.id}Thinking`, '').trim();
			const spec = provider.runSpec(model || undefined, thinking || undefined);
			({ stdout, stderr, code } = await this.runner.run(
				spec.bin,
				spec.promptInArgs ? [...spec.listArgs, prompt] : spec.listArgs,
				cwd,
				spec.promptInArgs ? '' : prompt,
				generationId
			));
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			if (detail === CANCELLED) return 'cancelled';
			return { error: redactSecrets(detail) };
		}

		const combined = `${stderr}\n${stdout}`;
		if (provider.needsLogin(combined)) {
			return { error: `${provider.label} is not logged in on this machine.`, needsLogin: true };
		}
		if (code !== 0) {
			const detail = (stderr.trim() || stdout.trim() || `exit code ${code}`).slice(0, 400);
			return { error: `${provider.label} failed: ${redactSecrets(detail)}` };
		}

		const parsed = parseCommitPlan(
			provider.extractText(stdout),
			listChanges.map((change) => change.path)
		);
		if (parsed.error) return { error: parsed.error };
		return { plan: parsed.plan };
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

		// The plan was drawn over the staged files, which may since have moved on. A planned file
		// that is no longer staged is no longer something the user chose to commit.
		const working = await getStatus(this.executor, cwd);
		const setCurrent = new Set(working.staged.map((change) => change.path));
		const listGone = message.listGroups
			.flatMap((group) => group.listFiles)
			.filter((file) => !setCurrent.has(file));
		if (listGone.length > 0) {
			return fail(0, 'The staged files changed since this plan was made — generate it again.');
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
		// The plan is spent; a rehydrating view must not be offered commits that already exist.
		this.cache.clear(message.repoPath);
		return { type: 'commitPlanExecuted', nonce: message.nonce, committed, total };
	}

	private async buildPrompt(
		cwd: string,
		listChanges: FileChange[]
	): Promise<{ prompt: string; additions: number; deletions: number }> {
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

		let additions = 0;
		let deletions = 0;
		for (const change of listChanges) {
			const counts = mapCounts.get(change.path);
			additions += counts?.additions ?? 0;
			deletions += counts?.deletions ?? 0;
		}
		return {
			prompt: buildCommitPrompt({
				branch,
				listRecentSubjects,
				listFiles,
				language: this.aiConfig().get<string>('language', ''),
			}),
			additions,
			deletions,
		};
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
