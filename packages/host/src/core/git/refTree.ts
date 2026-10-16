/**
 * Group slash-separated ref names into a folder tree, the way Fork's sidebar shows
 * `feature/ZG-1234_x` under a `feature` folder. Pure — feeds the sidebar TreeView.
 */

export interface RefTreeFolder {
	kind: 'folder';
	name: string;
	listChildren: RefTreeNode[];
}

export interface RefTreeLeaf {
	kind: 'leaf';
	/** Last path segment, shown as the label. */
	name: string;
	/** The full ref name, e.g. "feature/ZG-1234_x". */
	fullName: string;
}

export type RefTreeNode = RefTreeFolder | RefTreeLeaf;

/** Folders first, then leaves, each alphabetically — the layout every file tree trains the eye for. */
export function buildRefTree(listNames: string[]): RefTreeNode[] {
	const root: RefTreeFolder = { kind: 'folder', name: '', listChildren: [] };
	const mapFolders = new Map<string, RefTreeFolder>([['', root]]);

	for (const fullName of [...listNames].sort()) {
		const listSegments = fullName.split('/');
		let parentPath = '';
		for (let depth = 0; depth < listSegments.length - 1; depth++) {
			const path = parentPath === '' ? listSegments[depth] : `${parentPath}/${listSegments[depth]}`;
			if (!mapFolders.has(path)) {
				const folder: RefTreeFolder = {
					kind: 'folder',
					name: listSegments[depth],
					listChildren: [],
				};
				mapFolders.get(parentPath)!.listChildren.push(folder);
				mapFolders.set(path, folder);
			}
			parentPath = path;
		}
		mapFolders.get(parentPath)!.listChildren.push({
			kind: 'leaf',
			name: listSegments[listSegments.length - 1],
			fullName,
		});
	}

	sortTree(root);
	return root.listChildren;
}

function sortTree(folder: RefTreeFolder): void {
	folder.listChildren.sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
	for (const child of folder.listChildren) {
		if (child.kind === 'folder') sortTree(child);
	}
}
