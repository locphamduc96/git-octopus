import { beforeEach, describe, expect, it } from 'vitest';
import { FakeGit } from '../../test/fakeGit.js';
import { recorded, resetRecorded } from '../../test/vscodeStub.js';
import { UndoService } from './UndoService.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const CWD = '/repo';

/**
 * A git whose branch tips can be moved between calls, so one service can be driven through a real
 * record-then-undo cycle rather than have its two halves tested apart.
 */
class ScriptedGit extends FakeGit {
	public mapTips: Record<string, string> = { main: A };
	public head: { branch: string | null; hash: string } = { branch: 'main', hash: A };
	public dirty = false;

	// Chained onto `super.run` rather than run beside it: the base class is what records the call
	// and what honours `rejectOn`, and a scripted answer must not paper over a scripted failure.
	public override run(args: string[], cwd?: string, listOkCodes?: number[]): Promise<string> {
		return super.run(args, cwd, listOkCodes).then(() => {
			const argv = args.join(' ');
			if (argv.startsWith('for-each-ref'))
				return Object.entries(this.mapTips)
					.map(([name, hash]) => `${name}\0${hash}`)
					.join('\n');
			if (argv.startsWith('symbolic-ref')) return this.head.branch ?? '';
			if (argv.startsWith('rev-parse')) return this.head.hash;
			if (argv.startsWith('status')) return this.dirty ? ' M a.ts\n' : '';
			return '';
		});
	}
}

beforeEach(resetRecorded);

describe('UndoService', () => {
	it('offers nothing before anything has happened', () => {
		expect(new UndoService(new ScriptedGit()).labelFor(CWD)).toBeNull();
	});

	it('offers nothing for a repository it has never seen', () => {
		expect(new UndoService(new ScriptedGit()).labelFor(null)).toBeNull();
	});

	it('records an action that moved a branch, and names it', async () => {
		const git = new ScriptedGit();
		const undo = new UndoService(git);
		await undo.record('merge of dev into main', CWD, () => {
			git.mapTips = { main: B };
			git.head = { branch: 'main', hash: B };
			return Promise.resolve(true);
		});
		expect(undo.labelFor(CWD)).toBe('merge of dev into main');
	});

	// An action the user cancelled must not become the thing Undo offers.
	it('records nothing for an action that reported no change', async () => {
		const git = new ScriptedGit();
		const undo = new UndoService(git);
		await undo.record('merge', CWD, () => Promise.resolve(false));
		expect(undo.labelFor(CWD)).toBeNull();
	});

	// A copy-to-clipboard action returns true from nothing; the diff is what says it changed no ref.
	it('records nothing when no ref actually moved', async () => {
		const git = new ScriptedGit();
		const undo = new UndoService(git);
		await undo.record('copy hash', CWD, () => Promise.resolve(true));
		expect(undo.labelFor(CWD)).toBeNull();
	});

	it('resets the branch back and then has nothing left to offer', async () => {
		const git = new ScriptedGit();
		const undo = new UndoService(git);
		await undo.record('merge of dev into main', CWD, () => {
			git.mapTips = { main: B };
			git.head = { branch: 'main', hash: B };
			return Promise.resolve(true);
		});

		expect(await undo.run(CWD)).toBe(true);
		expect(git.callsTo('reset')).toEqual([['reset', '--hard', A]]);
		expect(undo.labelFor(CWD)).toBeNull();
		expect(recorded.listInfo.some((text) => text.includes('undid merge of dev into main'))).toBe(
			true
		);
	});

	it('checks the old branch out again after a checkout', async () => {
		const git = new ScriptedGit();
		git.mapTips = { main: A, dev: B };
		const undo = new UndoService(git);
		await undo.record('checkout of dev', CWD, () => {
			git.head = { branch: 'dev', hash: B };
			return Promise.resolve(true);
		});

		await undo.run(CWD);
		expect(git.callsTo('checkout')).toEqual([['checkout', 'main']]);
		expect(git.ran('reset')).toBe(false);
	});

	it('refuses over a dirty tree, and keeps the entry so it can be retried', async () => {
		const git = new ScriptedGit();
		const undo = new UndoService(git);
		await undo.record('merge', CWD, () => {
			git.mapTips = { main: B };
			git.head = { branch: 'main', hash: B };
			return Promise.resolve(true);
		});

		git.dirty = true;
		expect(await undo.run(CWD)).toBe(false);
		expect(git.ran('reset')).toBe(false);
		expect(undo.labelFor(CWD)).toBe('merge');
		expect(recorded.listErrors.some((text) => text.includes('uncommitted changes'))).toBe(true);
	});

	// A refusal that can never stop being true must not keep offering itself.
	it('drops an entry the repository has moved past', async () => {
		const git = new ScriptedGit();
		const undo = new UndoService(git);
		await undo.record('merge', CWD, () => {
			git.mapTips = { main: B };
			git.head = { branch: 'main', hash: B };
			return Promise.resolve(true);
		});

		git.mapTips = { main: 'c'.repeat(40) };
		git.head = { branch: 'main', hash: 'c'.repeat(40) };
		expect(await undo.run(CWD)).toBe(true);
		expect(git.ran('reset')).toBe(false);
		expect(undo.labelFor(CWD)).toBeNull();
		expect(recorded.listErrors.some((text) => text.includes('has moved'))).toBe(true);
	});

	it('says there is nothing to undo rather than doing something', async () => {
		const git = new ScriptedGit();
		expect(await new UndoService(git).run(CWD)).toBe(true);
		expect(git.ran('reset')).toBe(false);
		expect(recorded.listErrors.some((text) => text.includes('nothing to undo'))).toBe(true);
	});

	// Half an undo leaves a repository the recorded entry no longer describes.
	it('drops the entry when a command fails part-way', async () => {
		const git = new ScriptedGit();
		const undo = new UndoService(git);
		await undo.record('merge', CWD, () => {
			git.mapTips = { main: B };
			git.head = { branch: 'main', hash: B };
			return Promise.resolve(true);
		});

		git.rejectOn('reset', 'could not reset');
		expect(await undo.run(CWD)).toBe(true);
		expect(undo.labelFor(CWD)).toBeNull();
		expect(recorded.listErrors.some((text) => text.includes('could not undo merge'))).toBe(true);
	});

	it('keeps one entry per repository', async () => {
		const git = new ScriptedGit();
		const undo = new UndoService(git);
		await undo.record('merge', CWD, () => {
			git.mapTips = { main: B };
			git.head = { branch: 'main', hash: B };
			return Promise.resolve(true);
		});
		expect(undo.labelFor('/other')).toBeNull();
		expect(undo.labelFor(CWD)).toBe('merge');
	});

	// Unreadable status is not proof of a clean tree.
	it('treats an unreadable status as dirty rather than resetting over it', async () => {
		const git = new ScriptedGit();
		const undo = new UndoService(git);
		await undo.record('merge', CWD, () => {
			git.mapTips = { main: B };
			git.head = { branch: 'main', hash: B };
			return Promise.resolve(true);
		});

		git.rejectOn('status', 'cannot read');
		expect(await undo.run(CWD)).toBe(false);
		expect(git.ran('reset')).toBe(false);
	});
});

describe('UndoService redo', () => {
	/** A recorded move of main from A to B, ready to be undone. */
	async function afterMerge(): Promise<{ git: ScriptedGit; undo: UndoService }> {
		const git = new ScriptedGit();
		const undo = new UndoService(git);
		await undo.record('merge of dev into main', CWD, () => {
			git.mapTips = { main: B };
			git.head = { branch: 'main', hash: B };
			return Promise.resolve(true);
		});
		return { git, undo };
	}

	it('offers the undone action back, and puts it back on redo', async () => {
		const { git, undo } = await afterMerge();
		expect(undo.redoLabelFor(CWD)).toBeNull();

		await undo.run(CWD);
		expect(git.callsTo('reset')).toEqual([['reset', '--hard', A]]);
		expect(undo.redoLabelFor(CWD)).toBe('merge of dev into main');
		expect(undo.labelFor(CWD)).toBeNull();

		git.mapTips = { main: A };
		git.head = { branch: 'main', hash: A };
		await undo.redo(CWD);
		expect(git.callsTo('reset').at(-1)).toEqual(['reset', '--hard', B]);
		expect(undo.redoLabelFor(CWD)).toBeNull();
		expect(undo.labelFor(CWD)).toBe('merge of dev into main');
	});

	it('forgets what could be redone once a new action is recorded', async () => {
		const { git, undo } = await afterMerge();
		await undo.run(CWD);
		git.mapTips = { main: A };
		await undo.record('commit', CWD, () => {
			git.mapTips = { main: 'c'.repeat(40) };
			git.head = { branch: 'main', hash: 'c'.repeat(40) };
			return Promise.resolve(true);
		});
		expect(undo.redoLabelFor(CWD)).toBeNull();
	});

	it('refuses a redo when the branch moved since the undo, and says redo', async () => {
		const { git, undo } = await afterMerge();
		await undo.run(CWD);
		git.mapTips = { main: 'd'.repeat(40) };
		await undo.redo(CWD);
		expect(git.ran('reset --hard ' + B)).toBe(false);
		expect(recorded.listErrors.join('\n')).toMatch(/redo/);
	});
});
