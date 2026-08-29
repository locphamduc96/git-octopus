import type { WorkingTreeAction } from '@git-octopus/shared';
import type { MenuItem } from './ui/ContextMenu.svelte';

export interface FileMenuAction {
	id: WorkingTreeAction;
	label: string;
}

/**
 * The entries the menu owns outright — every other id in it is a working-tree action a section
 * handed over. The two spaces share no name, so the id alone says which half it belongs to.
 */
export type LocalFileMenuId =
	'openChanges' | 'openFile' | 'openFileAtRev' | 'copyPath' | 'copyRelativePath';

export interface FileMenuOptions {
	/** Actions the row itself offers — stage, unstage, discard. Listed last, after a separator. */
	listActions?: FileMenuAction[];
	/** A commit is on screen, so the file can also be opened as it was at that commit. */
	atRevision?: boolean;
	/** The commit deleted this file, so there is no content to open — only the diff. */
	deleted?: boolean;
}

/** Items for the menu that opens on right-clicking a file, in the order they are shown. */
export function buildFileMenu(
	options: FileMenuOptions
): MenuItem<LocalFileMenuId | WorkingTreeAction>[] {
	const listItems: MenuItem<LocalFileMenuId | WorkingTreeAction>[] = [
		{ id: 'openChanges', label: 'Open Changes' },
	];

	if (!options.deleted) {
		listItems.push({ id: 'openFile', label: 'Open File' });
		if (options.atRevision) {
			listItems.push({ id: 'openFileAtRev', label: 'Open File at this Commit' });
		}
	}

	listItems.push(
		{ id: 'copyPath', label: 'Copy Path', separatorBefore: true },
		{ id: 'copyRelativePath', label: 'Copy Relative Path' }
	);

	options.listActions?.forEach((action, index) => {
		listItems.push({ ...action, separatorBefore: index === 0 });
	});

	return listItems;
}
