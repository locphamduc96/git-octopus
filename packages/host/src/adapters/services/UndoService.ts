import type { HostShell } from '../../app/ports/shell.js';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import { showGitError } from './staleLockNotice.js';
import {
	describeRefusal,
	diffSnapshots,
	invertEntry,
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
	/** The action last undone, inverted — what Redo puts back. Cleared by any newer action. */
	private readonly mapRedo = new Map<string, UndoEntry>();

	public constructor(
		private readonly executor: GitExecutor,
		private readonly shell: HostShell
	) {}

	/** What pressing Undo would undo, or null when there is nothing to undo in this repository. */
	public labelFor(cwd: string | null): string | null {
		return cwd ? (this.mapEntries.get(cwd)?.label ?? null) : null;
	}

	public redoLabelFor(cwd: string | null): string | null {
		return cwd ? (this.mapRedo.get(cwd)?.label ?? null) : null;
	}

	/**
	 * Run one repository-changing action and record what it actually did.
	 *
	 * The record is a diff of two snapshots, not a note the action wrote about itself — see
	 * `core/git/undo.ts` for why the difference matters. An action that reports no change is not
	 * snapshotted twice: it did nothing, so there is nothing to remember, and the previous entry
	 * stays the one Undo offers.
	 */
	public async record(label: string, cwd: string, work: () => Promise<boolean>): Promise<boolean> {
		const before = await this.snapshot(cwd);
		const changed = await work();
		if (!changed) return false;
		const entry = diffSnapshots(label, before, await this.snapshot(cwd));
		if (entry) {
			this.mapEntries.set(cwd, entry);
			// A new action is a new history: what was undone before it can no longer be put back.
			this.mapRedo.delete(cwd);
		}
		return true;
	}

	/** Undo the last action that moved a ref; on success it becomes what Redo would put back. */
	public async run(cwd: string): Promise<boolean> {
		const entry = this.mapEntries.get(cwd) ?? null;
		const done = await this.apply(cwd, entry, this.mapEntries, 'undo');
		if (done === 'applied' && entry) this.mapRedo.set(cwd, invertEntry(entry));
		return done !== 'refused';
	}

	/** Put back the action last undone; on success it is undoable again. */
	public async redo(cwd: string): Promise<boolean> {
		const entry = this.mapRedo.get(cwd) ?? null;
		const done = await this.apply(cwd, entry, this.mapRedo, 'redo');
		if (done === 'applied' && entry) this.mapEntries.set(cwd, invertEntry(entry));
		return done !== 'refused';
	}

	/** Put the repository back. Returns true when something changed and the graph should reload. */
	/**
	 * Run one entry's plan — undo of `mapEntries`' entry, or of `mapRedo`'s inverted one, which is
	 * a redo. `applied` means the repository is back where the entry says; `changed` that something
	 * ran or was cleared and the views should refresh; `refused` that nothing happened at all.
	 */
	private async apply(
		cwd: string,
		entry: UndoEntry | null,
		mapFrom: Map<string, UndoEntry>,
		verb: 'undo' | 'redo'
	): Promise<'applied' | 'changed' | 'refused'> {
		const plan = planUndo({
			entry,
			now: await this.snapshot(cwd),
			dirty: await this.isDirty(cwd),
		});
		if (!plan.ok) {
			const sentence = describeRefusal(plan).replace(/\bundo/g, verb);
			this.shell.notify.error(`Git Octopus: ${sentence}`);
			// A refusal that will never stop being true is worth clearing, so the button stops
			// offering something that cannot happen. A dirty tree is not one of those.
			if (plan.reason !== 'dirty') mapFrom.delete(cwd);
			return plan.reason === 'dirty' ? 'refused' : 'changed';
		}

		for (const args of plan.listCommands) {
			try {
				await this.executor.run(args, cwd);
			} catch (err) {
				const raw = err instanceof Error ? err.message : String(err);
				// Undo runs a chain of index writes, so it is one of the likeliest places to meet a
				// stale lock — hence the offer to clear one, on top of saying what failed.
				void showGitError(this.shell.notify, raw, cwd, { lead: `could not ${verb} ${plan.label}` });
				// Whatever ran before the failure has already happened, so the recorded entry no
				// longer describes the repository. Drop it rather than offer a second wrong one.
				mapFrom.delete(cwd);
				return 'changed';
			}
		}
		mapFrom.delete(cwd);
		this.shell.notify.info(`Git Octopus: ${verb === 'undo' ? 'undid' : 'redid'} ${plan.label}.`);
		return 'applied';
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
