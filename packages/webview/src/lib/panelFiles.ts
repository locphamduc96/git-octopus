import type { CommitDetails, FileChange, WorkingTreeStatus } from '@git-octopus/shared';
import type { PanelMode } from '../features/changes-panel/ChangesPanel.svelte';
import { buildFileTree, type FileTreeNode, type FileViewMode } from './fileTree';
import { nextRowIndex } from './keyNav';

/** The files of a tree in the order they are drawn, folders opened as they are in the view. */
export function flattenTree(listNodes: FileTreeNode[]): FileChange[] {
	const listFiles: FileChange[] = [];
	for (const node of listNodes) {
		if (node.kind === 'folder') listFiles.push(...flattenTree(node.children));
		else listFiles.push(node.file);
	}
	return listFiles;
}

/**
 * The working-tree tab is four sections, each its own list or tree. Stepping must follow what the
 * eye follows — down one section, then into the next — so they are concatenated in display order,
 * each laid out the way the view lays it out. A list keeps the original order; a tree follows the
 * folders. Collapsed folders are not skipped: stepping into one opens it.
 */
export function buildPanelFiles(input: {
	mode: PanelMode;
	working: WorkingTreeStatus | null;
	details: CommitDetails | null;
	listComparisonFiles: FileChange[];
	fileView: FileViewMode;
}): FileChange[] {
	const order = (listFiles: FileChange[]): FileChange[] =>
		input.fileView === 'tree' ? flattenTree(buildFileTree(listFiles)) : listFiles;
	switch (input.mode) {
		case 'changes': {
			const working = input.working;
			if (!working) return [];
			const listConflicts = working.unstaged.filter((f) => f.status === 'U');
			const listChanges = working.unstaged.filter((f) => f.status !== '?' && f.status !== 'U');
			const listUntracked = working.unstaged.filter((f) => f.status === '?');
			return [
				...order(listConflicts),
				...order(listChanges),
				...order(listUntracked),
				...order(working.staged),
			];
		}
		case 'commit':
			return order(input.details?.files ?? []);
		default:
			return order(input.listComparisonFiles);
	}
}

/**
 * Where a navigation key lands in the file list, clamped at both ends: the list never spills into
 * the next commit. A path that is no longer listed — the file was staged away, the commit changed
 * — starts from the top, the same way the graph treats a lost selection. Null when there is
 * nowhere to go or nothing would change.
 */
export function stepPath(
	listFiles: FileChange[],
	currentPath: string | null,
	key: string,
	pageJump: number
): string | null {
	if (listFiles.length === 0) return null;
	const current = currentPath === null ? -1 : listFiles.findIndex((f) => f.path === currentPath);
	const next = nextRowIndex(key, current, listFiles.length - 1, pageJump);
	const path = listFiles[next].path;
	return path === currentPath ? null : path;
}
