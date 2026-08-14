export interface FileMenuAction {
	id: string;
	label: string;
}

export interface FileMenuItem {
	id: string;
	label: string;
	separatorBefore?: boolean;
}

export interface FileMenuOptions {
	/** Actions the row itself offers — stage, unstage, discard. Listed last, after a separator. */
	listActions?: FileMenuAction[];
	/** A commit is on screen, so the file can also be opened as it was at that commit. */
	atRevision?: boolean;
	/** The commit deleted this file, so there is no content to open — only the diff. */
	deleted?: boolean;
}

/** Items for the menu that opens on right-clicking a file, in the order they are shown. */
export function buildFileMenu(options: FileMenuOptions): FileMenuItem[] {
	const listItems: FileMenuItem[] = [{ id: 'openChanges', label: 'Open Changes' }];

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
