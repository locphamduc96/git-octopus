import { onHostType, onRepoReset } from '../hostRouter';

/** What was typed in the commit dialog, kept until a commit with it lands. */
export interface CommitDraft {
	summary: string;
	description: string;
	amend: boolean;
	noVerify: boolean;
}

let draft = $state<CommitDraft | null>(null);
/** Bumped when the host refuses a commit that has a draft: the dialog comes back with it. */
let reopenNonce = $state(0);

onHostType('commitOutcome', (message) => {
	if (message.ok) {
		draft = null;
		return;
	}
	if (draft) reopenNonce += 1;
});

onRepoReset(() => {
	draft = null;
});

export const commitDraft = {
	get current(): CommitDraft | null {
		return draft;
	},
	get reopenNonce(): number {
		return reopenNonce;
	},
	keep(next: CommitDraft): void {
		draft = next;
	},
	/** Cancelling the dialog means "not committing this" — the draft goes with it. */
	clear(): void {
		draft = null;
	},
};
