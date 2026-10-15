import { describe, expect, it } from 'vitest';
import {
	invertEntry,
	describeRefusal,
	diffSnapshots,
	headMoved,
	planUndo,
	type RepoSnapshot,
	type UndoEntry,
} from './undo.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

const snap = (
	mapTips: Record<string, string>,
	branch: string | null,
	hash: string
): RepoSnapshot => ({
	mapTips,
	head: { branch, hash },
});

describe('headMoved', () => {
	it('is true when HEAD changed branch', () => {
		expect(headMoved({ branch: 'main', hash: A }, { branch: 'dev', hash: A })).toBe(true);
	});

	it('is true when HEAD attached or detached', () => {
		expect(headMoved({ branch: null, hash: A }, { branch: 'main', hash: A })).toBe(true);
	});

	// A branch moving under HEAD is a ref move, not a checkout — undoing it is a reset, not a
	// checkout, and conflating the two would make the plan run the wrong command.
	it('is false when the branch merely advanced under HEAD', () => {
		expect(headMoved({ branch: 'main', hash: A }, { branch: 'main', hash: B })).toBe(false);
	});

	it('is true when a detached HEAD moved to another commit', () => {
		expect(headMoved({ branch: null, hash: A }, { branch: null, hash: B })).toBe(true);
	});
});

describe('diffSnapshots', () => {
	it('answers null when nothing moved', () => {
		const before = snap({ main: A }, 'main', A);
		expect(diffSnapshots('Copy', before, snap({ main: A }, 'main', A))).toBeNull();
	});

	it('records a branch that advanced', () => {
		const entry = diffSnapshots(
			'Merge',
			snap({ main: A }, 'main', A),
			snap({ main: B }, 'main', B)
		);
		expect(entry?.listChanges).toEqual([{ branch: 'main', before: A, after: B }]);
	});

	it('records a branch that was created', () => {
		const entry = diffSnapshots(
			'Create branch',
			snap({ main: A }, 'main', A),
			snap({ main: A, dev: A }, 'main', A)
		);
		expect(entry?.listChanges).toEqual([{ branch: 'dev', before: null, after: A }]);
	});

	it('records a branch that was deleted', () => {
		const entry = diffSnapshots(
			'Delete branch',
			snap({ main: A, dev: B }, 'main', A),
			snap({ main: A }, 'main', A)
		);
		expect(entry?.listChanges).toEqual([{ branch: 'dev', before: B, after: null }]);
	});

	// `checkout -b` does two things at once; an entry that recorded only one would half-undo.
	it('records a creation and a checkout together', () => {
		const entry = diffSnapshots(
			'Create branch',
			snap({ main: A }, 'main', A),
			snap({ main: A, dev: A }, 'dev', A)
		);
		expect(entry?.listChanges).toEqual([{ branch: 'dev', before: null, after: A }]);
		expect(entry?.headBefore.branch).toBe('main');
		expect(entry?.headAfter.branch).toBe('dev');
	});

	// The case a HEAD-only model misses: `fetch . source:target` moves a branch nobody stands on.
	it('records a branch that moved without HEAD following it', () => {
		const entry = diffSnapshots(
			'Fast-forward',
			snap({ main: A, dev: A }, 'main', A),
			snap({ main: A, dev: B }, 'main', A)
		);
		expect(entry?.listChanges).toEqual([{ branch: 'dev', before: A, after: B }]);
	});

	it('records a bare checkout, which moves no ref at all', () => {
		const entry = diffSnapshots(
			'Checkout dev',
			snap({ main: A, dev: B }, 'main', A),
			snap({ main: A, dev: B }, 'dev', B)
		);
		expect(entry?.listChanges).toEqual([]);
		expect(entry).not.toBeNull();
	});
});

describe('planUndo', () => {
	const moved: UndoEntry = {
		label: 'Merge dev into main',
		listChanges: [{ branch: 'main', before: A, after: B }],
		headBefore: { branch: 'main', hash: A },
		headAfter: { branch: 'main', hash: B },
	};

	it('refuses when there is nothing recorded', () => {
		expect(planUndo({ entry: null, now: snap({ main: A }, 'main', A), dirty: false })).toEqual({
			ok: false,
			reason: 'nothing',
		});
	});

	it('resets the current branch back to where it was', () => {
		const plan = planUndo({ entry: moved, now: snap({ main: B }, 'main', B), dirty: false });
		expect(plan).toEqual({
			ok: true,
			label: 'Merge dev into main',
			listCommands: [['reset', '--hard', A]],
		});
	});

	it('refuses once the branch has moved on', () => {
		expect(planUndo({ entry: moved, now: snap({ main: C }, 'main', C), dirty: false })).toEqual({
			ok: false,
			reason: 'refMoved',
			branch: 'main',
		});
	});

	it('refuses while the working tree is dirty, rather than overwriting it', () => {
		expect(planUndo({ entry: moved, now: snap({ main: B }, 'main', B), dirty: true })).toEqual({
			ok: false,
			reason: 'dirty',
		});
	});

	it('refuses once HEAD has been checked out elsewhere', () => {
		expect(
			planUndo({ entry: moved, now: snap({ main: B, dev: C }, 'dev', C), dirty: false })
		).toEqual({ ok: false, reason: 'headMoved' });
	});

	it('checks the old branch out again after a checkout', () => {
		const entry: UndoEntry = {
			label: 'Checkout dev',
			listChanges: [],
			headBefore: { branch: 'main', hash: A },
			headAfter: { branch: 'dev', hash: B },
		};
		const plan = planUndo({ entry, now: snap({ main: A, dev: B }, 'dev', B), dirty: false });
		expect(plan).toEqual({ ok: true, label: 'Checkout dev', listCommands: [['checkout', 'main']] });
	});

	it('names a detached position by hash when putting HEAD back', () => {
		const entry: UndoEntry = {
			label: 'Checkout main',
			listChanges: [],
			headBefore: { branch: null, hash: C },
			headAfter: { branch: 'main', hash: A },
		};
		const plan = planUndo({ entry, now: snap({ main: A }, 'main', A), dirty: false });
		expect(plan).toEqual({ ok: true, label: 'Checkout main', listCommands: [['checkout', C]] });
	});

	// HEAD has to leave before the branch it stands on can be deleted.
	it('leaves the branch before deleting it', () => {
		const entry: UndoEntry = {
			label: 'Create branch dev',
			listChanges: [{ branch: 'dev', before: null, after: A }],
			headBefore: { branch: 'main', hash: A },
			headAfter: { branch: 'dev', hash: A },
		};
		const plan = planUndo({ entry, now: snap({ main: A, dev: A }, 'dev', A), dirty: false });
		expect(plan).toEqual({
			ok: true,
			label: 'Create branch dev',
			listCommands: [
				['checkout', 'main'],
				['branch', '-D', 'dev'],
			],
		});
	});

	it('recreates a branch that was deleted', () => {
		const entry: UndoEntry = {
			label: 'Delete branch dev',
			listChanges: [{ branch: 'dev', before: B, after: null }],
			headBefore: { branch: 'main', hash: A },
			headAfter: { branch: 'main', hash: A },
		};
		const plan = planUndo({ entry, now: snap({ main: A }, 'main', A), dirty: false });
		expect(plan).toEqual({
			ok: true,
			label: 'Delete branch dev',
			listCommands: [['branch', 'dev', B]],
		});
	});

	it('refuses when a branch it would recreate has come back on its own', () => {
		const entry: UndoEntry = {
			label: 'Delete branch dev',
			listChanges: [{ branch: 'dev', before: B, after: null }],
			headBefore: { branch: 'main', hash: A },
			headAfter: { branch: 'main', hash: A },
		};
		expect(planUndo({ entry, now: snap({ main: A, dev: C }, 'main', A), dirty: false })).toEqual({
			ok: false,
			reason: 'refMoved',
			branch: 'dev',
		});
	});

	// The branch nobody is standing on moves by compare-and-swap, so git refuses the write itself
	// if the ref changed between the proof above and the command.
	it('moves a branch other than HEAD with a compare-and-swap', () => {
		const entry: UndoEntry = {
			label: 'Fast-forward dev',
			listChanges: [{ branch: 'dev', before: A, after: B }],
			headBefore: { branch: 'main', hash: A },
			headAfter: { branch: 'main', hash: A },
		};
		const plan = planUndo({ entry, now: snap({ main: A, dev: B }, 'main', A), dirty: false });
		expect(plan).toEqual({
			ok: true,
			label: 'Fast-forward dev',
			listCommands: [['update-ref', 'refs/heads/dev', A, B]],
		});
	});

	// Nothing here touches the working tree, so uncommitted work is no reason to refuse.
	it('allows moving another branch back even with a dirty tree', () => {
		const entry: UndoEntry = {
			label: 'Fast-forward dev',
			listChanges: [{ branch: 'dev', before: A, after: B }],
			headBefore: { branch: 'main', hash: A },
			headAfter: { branch: 'main', hash: A },
		};
		const plan = planUndo({ entry, now: snap({ main: A, dev: B }, 'main', A), dirty: true });
		expect(plan.ok).toBe(true);
	});
});

describe('describeRefusal', () => {
	it('says something true and specific for every reason', () => {
		expect(describeRefusal({ reason: 'nothing' })).toContain('nothing to undo');
		expect(describeRefusal({ reason: 'headMoved' })).toContain('HEAD');
		expect(describeRefusal({ reason: 'refMoved', branch: 'dev' })).toContain('dev');
		expect(describeRefusal({ reason: 'dirty' })).toContain('uncommitted');
	});
});

describe('invertEntry', () => {
	it('swaps every ref and HEAD, so undoing it redoes the original', () => {
		const entry = diffSnapshots(
			'create feature',
			snap({ main: A }, 'main', A),
			snap({ main: A, feature: B }, 'feature', B)
		);
		if (!entry) throw new Error('expected an entry');
		const inverted = invertEntry(entry);
		const plan = planUndo({ entry: inverted, now: snap({ main: A }, 'main', A), dirty: false });
		expect(plan).toEqual({
			ok: true,
			label: 'create feature',
			listCommands: [
				// The branch has to exist before HEAD can go back onto it.
				['branch', 'feature', B],
				['checkout', 'feature'],
			],
		});
	});
});
