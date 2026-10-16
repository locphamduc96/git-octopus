import type { SubmoduleChange } from '@git-octopus/shared';

/** What moved inside a submodule, in the words the file row prints — empty when nothing did. */
export function submoduleNotes(change: SubmoduleChange): string[] {
	const listNotes: string[] = [];
	if (change.commitChanged) listNotes.push('new commits');
	if (change.modified) listNotes.push('modified content');
	if (change.untracked) listNotes.push('untracked content');
	return listNotes;
}
