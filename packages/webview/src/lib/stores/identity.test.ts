import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitIdentity, HostToWebview } from '@git-octopus/shared';

const work: GitIdentity = {
	label: 'Work',
	name: 'locpd2',
	email: 'locpd2@vng.com.vn',
	hostPattern: 'vng.com.vn',
};

/** An `identity` reply for a repo whose remote points at work, committing under another email. */
function identityReply(email: string): HostToWebview {
	return {
		type: 'identity',
		name: 'loc',
		email,
		hasLocalName: false,
		hasLocalEmail: false,
		listRemoteUrls: ['git@vng.com.vn:team/app.git'],
		globalName: 'loc',
		globalEmail: 'personal@gmail.com',
		listIdentities: [work],
	} as HostToWebview;
}

async function loadIdentity() {
	const listSent: { type: string; [key: string]: unknown }[] = [];
	vi.stubGlobal('acquireVsCodeApi', () => ({
		postMessage: (message: unknown) => listSent.push(message as { type: string }),
		getState: () => undefined,
		setState: () => undefined,
	}));
	vi.resetModules();
	const { identity } = await import('./identity.svelte');
	const { dispatchHostMessage, resetForRepo } = await import('../hostRouter');
	return { identity, listSent, dispatchHostMessage, resetForRepo };
}

describe('identity', () => {
	beforeEach(() => vi.unstubAllGlobals());

	it('lets a commit through when the remote and the email agree', async () => {
		const { identity, dispatchHostMessage } = await loadIdentity();
		dispatchHostMessage(identityReply(work.email));

		expect(identity.askBeforeCommit('commit', 'wip')).toBe(false);
		expect(identity.commitGuard).toBeNull();
	});

	it('holds a commit back when the remote suggests another identity', async () => {
		const { identity, dispatchHostMessage } = await loadIdentity();
		dispatchHostMessage(identityReply('personal@gmail.com'));

		expect(identity.askBeforeCommit('commit', 'wip')).toBe(true);
		expect(identity.commitGuard?.suggested).toEqual(work);
	});

	it('never interrupts a working-tree action that is not a commit', async () => {
		const { identity, dispatchHostMessage } = await loadIdentity();
		dispatchHostMessage(identityReply('personal@gmail.com'));

		expect(identity.askBeforeCommit('stage', undefined)).toBe(false);
	});

	it('commits under the old email when the user says commit anyway', async () => {
		const { identity, listSent, dispatchHostMessage } = await loadIdentity();
		dispatchHostMessage(identityReply('personal@gmail.com'));
		identity.askBeforeCommit('commit', 'wip');
		identity.answerCommitGuard('anyway');

		expect(listSent).toEqual([
			{ type: 'workingTreeAction', repoPath: '', action: 'commit', message: 'wip' },
		]);
	});

	it('switches first and holds the commit until the switch is confirmed', async () => {
		const { identity, listSent, dispatchHostMessage } = await loadIdentity();
		dispatchHostMessage(identityReply('personal@gmail.com'));
		identity.askBeforeCommit('commit', 'wip');
		identity.answerCommitGuard('switch');

		// Posting both at once could commit under the old email: the host handles them separately.
		expect(listSent.map((message) => message.type)).toEqual(['identityAction']);

		dispatchHostMessage(identityReply(work.email));
		expect(listSent.map((message) => message.type)).toEqual([
			'identityAction',
			'workingTreeAction',
		]);
	});

	it('commits nothing when the switch did not take', async () => {
		const { identity, listSent, dispatchHostMessage } = await loadIdentity();
		dispatchHostMessage(identityReply('personal@gmail.com'));
		identity.askBeforeCommit('commit', 'wip');
		identity.answerCommitGuard('switch');

		// The apply failed, so the reply comes back with the email it already had.
		dispatchHostMessage(identityReply('personal@gmail.com'));
		expect(listSent.map((message) => message.type)).toEqual(['identityAction']);
	});

	it('drops the pending commit when the view moves to another repository', async () => {
		const { identity, listSent, dispatchHostMessage, resetForRepo } = await loadIdentity();
		dispatchHostMessage(identityReply('personal@gmail.com'));
		identity.askBeforeCommit('commit', 'wip');
		identity.answerCommitGuard('switch');
		resetForRepo();

		expect(identity.commitGuard).toBeNull();
		// The switch that lands afterwards belongs to the new repository; it must not commit here.
		dispatchHostMessage(identityReply(work.email));
		expect(listSent.map((message) => message.type)).toEqual(['identityAction']);
	});

	it('clears the workspace list on a repo switch, so no other repo is shown as this one', async () => {
		const { identity, dispatchHostMessage, resetForRepo } = await loadIdentity();
		dispatchHostMessage({
			type: 'workspaceIdentities',
			listRepos: [{ repoPath: '/a', repoName: 'a', name: 'a', email: 'a@b.c', overridden: false }],
		} as HostToWebview);
		expect(identity.listWorkspaceIdentities).toHaveLength(1);

		resetForRepo();
		expect(identity.listWorkspaceIdentities).toEqual([]);
	});
});
