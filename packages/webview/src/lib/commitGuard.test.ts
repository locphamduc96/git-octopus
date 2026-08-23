import { describe, expect, it } from 'vitest';
import type { GitIdentity, WorkingTreeAction } from '@git-octopus/shared';
import { planCommitGuard } from './commitGuard';

const work: GitIdentity = { label: 'Work', name: 'locpd2', email: 'locpd2@vng.com.vn' };

describe('planCommitGuard', () => {
	it('asks before a commit when the remote suggests another identity', () => {
		expect(planCommitGuard('commit', work)).toEqual({ kind: 'ask', suggested: work });
	});

	it('lets a commit through when nothing is suggested', () => {
		expect(planCommitGuard('commit', null)).toEqual({ kind: 'proceed' });
	});

	it('never interrupts any other working-tree action, amend included', () => {
		const listOthers: WorkingTreeAction[] = [
			'stage',
			'unstage',
			'stageAll',
			'unstageAll',
			'discard',
			'stash',
			'amend',
			'undoCommit',
		];
		for (const action of listOthers) {
			expect(planCommitGuard(action, work)).toEqual({ kind: 'proceed' });
		}
	});
});
