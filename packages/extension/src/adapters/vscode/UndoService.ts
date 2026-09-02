import * as vscode from 'vscode';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import { friendlyGitError } from '../../core/git/friendlyGitError.js';
import {
	describeRefusal,
	diffSnapshots,
	planUndo,
	type RepoSnapshot,
	type UndoEntry,
} from '../../core/git/undo.js';

/**
 * Remembers what the last action did to the repository, and puts it back.
 *
 * One entry per repository, and only the most recent: a single step is what can be proved safe
 * before it runs, and a stack of them would each need re-proving against a repository that had
 * already moved twice.
 */
export class UndoService {
	private readonly mapEntries = new Map<string, UndoEntry>();

	public constructor(private readonly executor: GitExecutor) {}

	/** What pressing Undo would undo, or null when there is nothing to undo in this repository. */
	public labelFor(cwd: string | null): string | null {
		return cwd ? (this.mapEntries.get(cwd)?.label ?? null) : null;
	}

	/**
	 * Run one repository-changing action and record what it actually did.
	 *
	 * The record is a diff of two snapshots, not a note the action wrote about itself — see
	 * `core/git/undo.ts` for why the difference matters. An action that reports no change is not
	 * snapshotted twice: it did nothing, so there is nothing to remember, and the previous entry
	 * stays the one Undo offers.
	 */
	public async record(
		label: string,
		cwd: string,
		work: () => Promise<boolean>
	): Promise<boolean> {
		const before = await this.snapshot(cwd);
		const changed = await work();
		if (!changed) return false;
		const entry = diffSnapshots(label, before, await this.snapshot(cwd));
		if (entry) this.mapEntries.set(cwd, entry);
		return true;
	}

	/** Put the repository back. Returns true when something changed and the graph should reload. */
	public async run(cwd: string): Promise<boolean> {
		const plan = planUndo({
			entry: this.mapEntries.get(cwd) ?? null,
			now: await this.snapshot(cwd),
			dirty: await this.isDirty(cwd),
		});
		if (!plan.ok) {
			vscode.window.showErrorMessage(`Git Octopus: ${describeRefusal(plan)}`);
			// A refusal that will never stop being true is worth clearing, so the button stops
			// offering something that cannot happen. A dirty tree is not one of those.
			if (plan.reason !== 'dirty') this.mapEntries.delete(cwd);
			return plan.reason === 'dirty' ? false : true;
		}

		for (const args of plan.listCommands) {
			try {
				await this.executor.run(args, cwd);
			} catch (err) {
				const raw = err instanceof Error ? err.message : String(err);
				vscode.window.showErrorMessage(
					`Git Octopus: could not undo ${plan.label} — ${friendlyGitError(raw) ?? raw}`
				);
				// Whatever ran before the failure has already happened, so the recorded entry no
				// longer describes the repository. Drop it rather than offer a second wrong undo.
				this.mapEntries.delete(cwd);
				return true;
			}
		}
		this.mapEntries.delete(cwd);
		vscode.window.showInformationMessage(`Git Octopus: undid ${plan.label}.`);
		return true;
	}

	private async snapshot(cwd: string): Promise<RepoSnapshot> {
		const [tips, branch, hash] = await Promise.all([
			this.read(['for-each-ref', '--format=%(refname:short)%00%(objectname)', 'refs/heads'], cwd),
			// Empty output means HEAD is detached, which is an answer rather than a failure.
			this.read(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd, [1]),
			this.read(['rev-parse', 'HEAD'], cwd),
		]);
		const mapTips: Record<string, string> = {};
		for (const line of tips.split('\n')) {
			const [name, tip] = line.split('\0');
			if (name && tip) mapTips[name] = tip;
		}
		return { mapTips, head: { branch: branch === '' ? null : branch, hash } };
	}

	private async isDirty(cwd: string): Promise<boolean> {
		try {
			const output = await this.executor.run(
				['status', '--porcelain', '--untracked-files=normal'],
				cwd
			);
			return output.trim() !== '';
		} catch {
			// Unreadable status is not proof of a clean tree; assume dirty and refuse rather than
			// reset over work that might be there.
			return true;
		}
	}

	private async read(args: string[], cwd: string, listOkCodes?: number[]): Promise<string> {
		try {
			return (await this.executor.run(args, cwd, listOkCodes)).trim();
		} catch {
			return '';
		}
	}
}
