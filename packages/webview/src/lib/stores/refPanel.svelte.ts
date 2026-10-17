import type { RefPanelData } from '@git-octopus/shared';
import { onHostType } from '../hostRouter';

let currentData = $state<RefPanelData | null>(null);
let currentRepoPath = $state<string | null>(null);

onHostType('refPanel', ({ repoPath, data }) => {
	currentRepoPath = repoPath;
	currentData = data;
});

/** The side panel's refs as the host last sent them; `null` until the first `refPanel` arrives. */
export const refPanel = {
	get data(): RefPanelData | null {
		return currentData;
	},
	get repoPath(): string | null {
		return currentRepoPath;
	},
};
