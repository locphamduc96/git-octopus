import type { CommitPlanDraft } from '@git-octopus/shared';

/**
 * What the host remembers about each repository's AI commit generation.
 *
 * The agent process runs host-side and outlives any webview, so its outcome must too: a view
 * destroyed mid-run asks this cache when it comes back, instead of the answer dying with the
 * `postMessage` nobody heard. Generation ids are issued here, monotonic across every repository,
 * so they double as process keys and stay comparable across webview reloads.
 */

export interface PlanResult {
	plan?: CommitPlanDraft;
	error?: string;
	needsLogin?: boolean;
}

export interface PlanCacheEntry {
	generationId: number;
	status: 'running' | 'done';
	result?: PlanResult;
}

export class PlanCache {
	private readonly mapByRepo = new Map<string, PlanCacheEntry>();
	private nextGenerationId = 1;

	/** Start a run: issues the id and marks the repository as generating. */
	public begin(repoPath: string): number {
		const generationId = this.nextGenerationId++;
		this.mapByRepo.set(repoPath, { generationId, status: 'running' });
		return generationId;
	}

	/**
	 * Record a finished run. Refused (false) when a newer run has taken the slot or the run was
	 * cleared — a superseded result must not overwrite the one the user is waiting for.
	 */
	public complete(repoPath: string, generationId: number, result: PlanResult): boolean {
		const entry = this.mapByRepo.get(repoPath);
		if (!entry || entry.generationId !== generationId) return false;
		this.mapByRepo.set(repoPath, { generationId, status: 'done', result });
		return true;
	}

	public get(repoPath: string): PlanCacheEntry | null {
		return this.mapByRepo.get(repoPath) ?? null;
	}

	/** The id of the run in flight, or null — what a cancel needs to name its victim. */
	public runningId(repoPath: string): number | null {
		const entry = this.mapByRepo.get(repoPath);
		return entry?.status === 'running' ? entry.generationId : null;
	}

	/**
	 * Forget this run, if it still owns the slot: a cancelled run and an executed plan both
	 * leave nothing worth replaying.
	 */
	public clear(repoPath: string, generationId?: number): void {
		const entry = this.mapByRepo.get(repoPath);
		if (!entry) return;
		if (generationId !== undefined && entry.generationId !== generationId) return;
		this.mapByRepo.delete(repoPath);
	}
}
