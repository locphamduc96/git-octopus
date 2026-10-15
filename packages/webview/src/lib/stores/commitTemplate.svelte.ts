import { postToHost } from '../bridge';
import { onHostType, onRepoReset } from '../hostRouter';

/**
 * The repository's `commit.template`, asked for each time the commit dialog opens — the file can
 * change between commits. `undefined` while the answer is on its way, null when there is none.
 */
let text = $state<string | null | undefined>(undefined);

onHostType('commitTemplate', (message) => {
	text = message.text;
});

onRepoReset(() => {
	text = undefined;
});

export const commitTemplate = {
	get text(): string | null | undefined {
		return text;
	},
	request(): void {
		text = undefined;
		postToHost({ type: 'loadCommitTemplate' });
	},
};
