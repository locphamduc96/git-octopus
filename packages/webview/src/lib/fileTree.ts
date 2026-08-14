import type { FileChange } from '@git-octopus/shared';

/** How a set of changed files is laid out: full paths in a flat list, or grouped into folders. */
export type FileViewMode = 'list' | 'tree';

export type FileTreeNode =
	| { kind: 'folder'; name: string; path: string; children: FileTreeNode[] }
	| { kind: 'file'; name: string; file: FileChange };

interface FolderDraft {
	folders: Map<string, FolderDraft>;
	files: { name: string; file: FileChange }[];
}

/**
 * Group changed files into a folder tree.
 *
 * With `compact`, a folder whose only child is another folder is merged into it (`a` + `b` becomes
 * `a/b`), which keeps deep project layouts from turning into a column of single-entry folders.
 */
export function buildFileTree(listFiles: FileChange[], compact = true): FileTreeNode[] {
	const root: FolderDraft = { folders: new Map(), files: [] };

	for (const file of listFiles) {
		const listSegments = file.path.split('/');
		const name = listSegments.pop() ?? file.path;
		let folder = root;
		for (const segment of listSegments) {
			let next = folder.folders.get(segment);
			if (!next) {
				next = { folders: new Map(), files: [] };
				folder.folders.set(segment, next);
			}
			folder = next;
		}
		folder.files.push({ name, file });
	}

	return toNodes(root, '', compact);
}

function toNodes(draft: FolderDraft, prefix: string, compact: boolean): FileTreeNode[] {
	const listFolders: FileTreeNode[] = [];

	for (const [name, child] of [...draft.folders.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		let folderName = name;
		let folderDraft = child;
		let path = prefix === '' ? name : `${prefix}/${name}`;

		while (compact && folderDraft.files.length === 0 && folderDraft.folders.size === 1) {
			const [onlyName, onlyChild] = [...folderDraft.folders.entries()][0];
			folderName = `${folderName}/${onlyName}`;
			path = `${path}/${onlyName}`;
			folderDraft = onlyChild;
		}

		listFolders.push({
			kind: 'folder',
			name: folderName,
			path,
			children: toNodes(folderDraft, path, compact),
		});
	}

	const listFiles: FileTreeNode[] = draft.files
		.map(({ name, file }) => ({ kind: 'file' as const, name, file }))
		.sort((a, b) => a.name.localeCompare(b.name));

	return [...listFolders, ...listFiles];
}
