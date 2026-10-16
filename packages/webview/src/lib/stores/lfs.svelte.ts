import { onRepoReset } from '../hostRouter';
import { matchesLfs } from '../lfs';

/** The repository's LFS patterns, from its committed `.gitattributes`; set on every graph load. */
let listPatterns = $state<string[]>([]);

onRepoReset(() => {
	listPatterns = [];
});

export const lfs = {
	set(next: string[]): void {
		listPatterns = next;
	},
	/** The file is one LFS stores — its rows say so. */
	stores(path: string): boolean {
		return listPatterns.length > 0 && matchesLfs(path, listPatterns);
	},
};
