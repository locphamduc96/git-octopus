import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
	AiExplainMessage,
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
import { chunkPaths, splitDiffByPath } from '../../core/git/diffSplit.js';
import { promptDiffArgs, promptNumstatArgs } from '../../core/git/workingTreeDiff.js';
import { redactSecrets } from '../../core/git/redactSecrets.js';
import { classifyChanges, type ChangeEntry } from '../../core/agent/classifyChanges.js';
import { buildCommitPrompt, type PromptFile } from '../../core/agent/commitPrompt.js';
import { parseCommitPlan } from '../../core/agent/planParser.js';
import { LIST_AGENT_PROVIDERS, providerById } from '../../core/agent/agentProviders.js';
import { PlanCache, type PlanResult } from '../../core/agent/planCache.js';
import type { AgentProvider } from '../../core/agent/agentProviders.js';
import { buildExplainPrompt } from '../../core/agent/explainPrompt.js';
import { gatherExplainMaterial } from '../../core/agent/explainMaterial.js';
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
	/** Runner keys for explanations, well clear of the plan cache's generation ids. */
	private nextExplainKey = 1_000_000;

	/**
	 * `agentWorkdir` is where the agent CLI runs — an empty folder of our own, never the repository.
	 * The prompt already carries every diff the agent may read, and an agent started inside the
	 * repository may run git there on its own (Claude Code reads the repository's state as it
	 * starts): a process
	 * holding `.git/index.lock` that this extension neither started nor can wait for, and one that a
	 * cancel or a timeout kills mid-write. Fixed rather than fresh per run, so a CLI that asks to
	 * trust its folder asks once.
	 */
	public constructor(
		private readonly executor: GitExecutor,
		private readonly globalState: vscode.Memento,
		private readonly runner: AgentProcessRunner = new AgentProcessRunner(),
		private readonly agentWorkdir: string = path.join(os.tmpdir(), 'git-octopus-agent')
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
				await config.update(`${provider.id}Thinking`, thinking, vscode.ConfigurationTarget.Global);
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
			return {
				type: 'commitPlanResult',
				repoPath: message.repoPath,
				generationId,
				error: 'Cancelled.',
			};
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

		const { working } = await getStatus(this.executor, cwd);
		const listChanges = dedupeByPath(working.staged);
		if (listChanges.length === 0) return { error: 'There are no staged changes to commit.' };

		if ((await getHeadHash(this.executor, cwd)) === null) {
			return { error: 'The repository has no commits yet — make the first commit manually.' };
		}
		report({ stage: 'collected', fileCount: listChanges.length });

		const { prompt, additions, deletions } = await this.buildPrompt(cwd, listChanges);
		report({ stage: 'prompted', fileCount: listChanges.length, additions, deletions });

		const answer = await this.runAgent(provider, prompt, generationId);
		if (answer === 'cancelled' || 'error' in answer) return answer;

		const parsed = parseCommitPlan(
			answer.text,
			listChanges.map((change) => change.path)
		);
		if (parsed.error) return { error: parsed.error };
		return { plan: parsed.plan };
	}

	/**
	 * Run the agent once on `prompt`, in its own folder, with the user's model and thinking pins.
	 * A failure comes back as the message to show; a cancel as `'cancelled'`.
	 */
	private async runAgent(
		provider: AgentProvider,
		prompt: string,
		key: number
	): Promise<{ text: string } | { error: string; needsLogin?: boolean } | 'cancelled'> {
		let stdout: string;
		let stderr: string;
		let code: number | null;
		try {
			// The user's own CLI default may be an expensive model; these pins are how they cap it.
			const config = this.aiConfig();
			const model = config.get<string>(`${provider.id}Model`, '').trim();
			const thinking = config.get<string>(`${provider.id}Thinking`, '').trim();
			const spec = provider.runSpec(model || undefined, thinking || undefined);
			await fs.mkdir(this.agentWorkdir, { recursive: true });
			({ stdout, stderr, code } = await this.runner.run(
				spec.bin,
				spec.promptInArgs ? [...spec.listArgs, prompt] : spec.listArgs,
				this.agentWorkdir,
				spec.promptInArgs ? '' : prompt,
				key
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
		return { text: provider.extractText(stdout) };
	}

	/**
	 * Explain a commit, a branch or the uncommitted changes with the agent the AI commit uses, and
	 * open its account beside the graph as an unsaved Markdown document. Nothing is written to the
	 * repository; the agent sees what the commit prompt would — names always, content only for
	 * source files outside the exclude patterns.
	 */
	public async explain(message: AiExplainMessage, cwd: string): Promise<void> {
		const provider = providerById(this.globalState.get<string>(STATE_AI_AGENT));
		if (!provider || !this.globalState.get<boolean>(STATE_AI_CONSENT, false)) {
			void vscode.window.showErrorMessage(
				'Git Octopus: choose an agent CLI in the AI tab of the settings first.'
			);
			return;
		}
		const key = this.nextExplainKey++;
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Git Octopus: ${provider.label} is explaining`,
				cancellable: true,
			},
			async (progress, token) => {
				token.onCancellationRequested(() => this.runner.cancel(key));
				let material;
				try {
					material = await gatherExplainMaterial(this.executor, cwd, message.target, {
						listExcludePatterns: this.aiConfig().get<string[]>('excludePatterns', []),
						sizeOf: (file) => fileSize(path.join(cwd, file)),
					});
				} catch (error) {
					const detail = error instanceof Error ? error.message : String(error);
					void vscode.window.showErrorMessage(`Git Octopus: ${redactSecrets(detail)}`);
					return;
				}
				if (token.isCancellationRequested) return;
				progress.report({ message: material.title });
				const prompt = buildExplainPrompt({
					...material,
					language: this.aiConfig().get<string>('language', ''),
				});
				const answer = await this.runAgent(provider, prompt, key);
				if (answer === 'cancelled') return;
				if ('error' in answer) {
					void vscode.window.showErrorMessage(`Git Octopus: ${answer.error}`);
					return;
				}
				const text = answer.text.trim();
				if (text === '') {
					void vscode.window.showErrorMessage(
						`Git Octopus: ${provider.label} answered with nothing.`
					);
					return;
				}
				const document = await vscode.workspace.openTextDocument({
					language: 'markdown',
					content: `# ${material.title}\n\n_Explained by ${provider.label}._\n\n${text}\n`,
				});
				await vscode.window.showTextDocument(document, {
					viewColumn: vscode.ViewColumn.Beside,
					preview: false,
				});
			}
		);
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
		const { working } = await getStatus(this.executor, cwd);
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

	/**
	 * The unified diff of each source file, read in as few git processes as the argv allows.
	 *
	 * One command per file was the previous shape, and on a large staging it meant hundreds of git
	 * processes starting at once. A chunk that fails falls back to reading its files one at a time,
	 * so a single oversized diff costs only its own file rather than every file sharing the command.
	 */
	private async readDiffs(cwd: string, listPaths: string[]): Promise<Map<string, string>> {
		const mapDiffs = new Map<string, string>();
		for (const listChunk of chunkPaths(listPaths)) {
			const output = await this.executor.run(promptDiffArgs(listChunk), cwd).catch(() => null);
			if (output !== null) {
				for (const [file, diff] of splitDiffByPath(output, listChunk)) mapDiffs.set(file, diff);
				continue;
			}
			const listFallback = await mapLimited(listChunk, DIFF_CONCURRENCY, async (file) => ({
				file,
				diff: await this.executor.run(promptDiffArgs([file]), cwd).catch(() => ''),
			}));
			for (const entry of listFallback) if (entry.diff !== '') mapDiffs.set(entry.file, entry.diff);
		}
		return mapDiffs;
	}

	private async buildPrompt(
		cwd: string,
		listChanges: FileChange[]
	): Promise<{ prompt: string; additions: number; deletions: number }> {
		const listExcludePatterns = vscode.workspace
			.getConfiguration('gitOctopus.aiCommit')
			.get<string[]>('excludePatterns', []);

		const listEntries: ChangeEntry[] = await mapLimited(
			listChanges,
			STAT_CONCURRENCY,
			async (change) => ({
				path: change.path,
				status: change.status,
				bytes: await fileSize(path.join(cwd, change.path)),
			})
		);
		const listClassified = classifyChanges(listEntries, listExcludePatterns);

		const mapCounts = parseNumstat(
			await this.executor.run(promptNumstatArgs(), cwd).catch(() => '')
		);

		// Only source-tier files are ever shown to the agent, so only their diffs are fetched — an
		// asset-heavy staging must not pull megabytes of generated content into memory, and
		// `excludePatterns` is a promise about what leaves the machine, not just about what is printed.
		const mapDiffs = await this.readDiffs(
			cwd,
			listClassified.filter((entry) => entry.tier === 'source').map((entry) => entry.path)
		);

		const listFiles: PromptFile[] = listClassified.map((entry) => {
			const counts = mapCounts.get(entry.path);
			const file: PromptFile = {
				path: entry.path,
				status: entry.status,
				tier: entry.tier,
				...(counts ?? {}),
			};
			const diff = mapDiffs.get(entry.path);
			return diff === undefined ? file : { ...file, diff };
		});

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

/** How many files to stat at once — enough to stay fast, few enough to stay under EMFILE. */
const STAT_CONCURRENCY = 8;
/** How many single-file diffs to run at once when a batched read had to be abandoned. */
const DIFF_CONCURRENCY = 4;

/** `Promise.all` with a ceiling, for lists that are as long as the user's staging happens to be. */
async function mapLimited<T, R>(
	listItems: T[],
	limit: number,
	transform: (item: T) => Promise<R>
): Promise<R[]> {
	const listResults: R[] = new Array<R>(listItems.length);
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < listItems.length) {
			const index = next++;
			listResults[index] = await transform(listItems[index]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, listItems.length) }, worker));
	return listResults;
}

async function fileSize(absolutePath: string): Promise<number | undefined> {
	try {
		return (await fs.stat(absolutePath)).size;
	} catch {
		return undefined;
	}
}
