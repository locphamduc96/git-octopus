import * as vscode from 'vscode';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import {
	getAheadBehind,
	getBranchEntries,
	getRemoteNames,
	getStashes,
	getSubmodules,
	getTags,
} from '../../core/git/gitService.js';
import { buildRefTree, type RefTreeNode } from '../../core/git/refTree.js';

type Section = 'branches' | 'remotes' | 'tags' | 'stashes' | 'submodules';

export type RepoNode =
	| { kind: 'section'; section: Section; label: string }
	| { kind: 'folder'; label: string; listChildren: RepoNode[] }
	| { kind: 'branch'; name: string; hash: string; current: boolean; aheadBehind: string | null }
	| { kind: 'remoteRoot'; name: string }
	| {
			kind: 'remoteBranch';
			/** Display only — `remote` and `branch` are what any git command is built from. */
			fullName: string;
			remote: string;
			branch: string;
			label: string;
			hash: string;
	  }
	| { kind: 'tag'; name: string; hash: string }
	| { kind: 'stash'; name: string; hash: string; message: string }
	| { kind: 'submodule'; path: string; hash: string };

/**
 * Sidebar tree: Branches / Remotes / Tags / Stashes / Submodules, the Fork-style repository
 * overview. Clicking a ref reveals its commit in the graph; mutations run from context menus.
 */
export class RepoTreeProvider implements vscode.TreeDataProvider<RepoNode> {
	private readonly emitter = new vscode.EventEmitter<void>();
	public readonly onDidChangeTreeData = this.emitter.event;

	public constructor(
		private readonly executor: GitExecutor,
		/** The active repository is owned by the controller; the tree only ever asks. */
		private readonly getCwd: () => string | null
	) {}

	public refresh(): void {
		this.emitter.fire();
	}

	public async getChildren(node?: RepoNode): Promise<RepoNode[]> {
		const cwd = this.getCwd();
		if (!cwd) return [];
		if (!node) return this.rootSections(cwd);
		switch (node.kind) {
			case 'section':
				return this.sectionChildren(node.section, cwd);
			case 'folder':
				return node.listChildren;
			case 'remoteRoot': {
				const listEntries = await getBranchEntries(this.executor, cwd, `refs/remotes/${node.name}`);
				const mapByName = new Map(listEntries.map((entry) => [entry.name, entry]));
				// Group by the path under the remote, so "origin/feature/x" folders as "feature/x".
				const prefix = `${node.name}/`;
				const listTree = buildRefTree(listEntries.map((entry) => entry.name.slice(prefix.length)));
				return listTree.map((child) =>
					this.fromRefTree(child, (fullName) => {
						const entry = mapByName.get(`${prefix}${fullName}`);
						return {
							kind: 'remoteBranch',
							fullName: `${prefix}${fullName}`,
							remote: node.name,
							branch: fullName,
							label: fullName.split('/').pop() ?? fullName,
							hash: entry?.hash ?? '',
						};
					})
				);
			}
			default:
				return [];
		}
	}

	/** Only sections with content appear — an empty Submodules row is pure noise. */
	private async rootSections(cwd: string): Promise<RepoNode[]> {
		const [listRemotes, listSubmodules] = await Promise.all([
			getRemoteNames(this.executor, cwd),
			getSubmodules(this.executor, cwd),
		]);
		const listSections: RepoNode[] = [{ kind: 'section', section: 'branches', label: 'Branches' }];
		if (listRemotes.length > 0)
			listSections.push({ kind: 'section', section: 'remotes', label: 'Remotes' });
		listSections.push({ kind: 'section', section: 'tags', label: 'Tags' });
		listSections.push({ kind: 'section', section: 'stashes', label: 'Stashes' });
		if (listSubmodules.length > 0)
			listSections.push({ kind: 'section', section: 'submodules', label: 'Submodules' });
		return listSections;
	}

	private async sectionChildren(section: Section, cwd: string): Promise<RepoNode[]> {
		switch (section) {
			case 'branches': {
				const [listEntries, aheadBehind] = await Promise.all([
					getBranchEntries(this.executor, cwd, 'refs/heads'),
					getAheadBehind(this.executor, cwd),
				]);
				const mapByName = new Map(listEntries.map((entry) => [entry.name, entry]));
				const badge =
					aheadBehind.ahead > 0 || aheadBehind.behind > 0
						? [
								aheadBehind.ahead > 0 ? `↑${aheadBehind.ahead}` : '',
								aheadBehind.behind > 0 ? `↓${aheadBehind.behind}` : '',
							]
								.filter((part) => part !== '')
								.join(' ')
						: null;
				return buildRefTree(listEntries.map((entry) => entry.name)).map((child) =>
					this.fromRefTree(child, (fullName) => {
						const entry = mapByName.get(fullName);
						return {
							kind: 'branch',
							name: fullName,
							hash: entry?.hash ?? '',
							current: entry?.current ?? false,
							aheadBehind: entry?.current ? badge : null,
						};
					})
				);
			}
			case 'remotes':
				return (await getRemoteNames(this.executor, cwd)).map((name) => ({
					kind: 'remoteRoot',
					name,
				}));
			case 'tags':
				return (await getTags(this.executor, cwd)).map((tag) => ({ kind: 'tag', ...tag }));
			case 'stashes':
				return (await getStashes(this.executor, cwd)).map((stash) => ({
					kind: 'stash',
					...stash,
				}));
			case 'submodules':
				return (await getSubmodules(this.executor, cwd)).map((submodule) => ({
					kind: 'submodule',
					...submodule,
				}));
		}
	}

	/** Fold a pure ref-tree node into tree nodes, leaves built by the section's own factory. */
	private fromRefTree(node: RefTreeNode, makeLeaf: (fullName: string) => RepoNode): RepoNode {
		if (node.kind === 'leaf') return makeLeaf(node.fullName);
		return {
			kind: 'folder',
			label: node.name,
			listChildren: node.listChildren.map((child) => this.fromRefTree(child, makeLeaf)),
		};
	}

	public getTreeItem(node: RepoNode): vscode.TreeItem {
		switch (node.kind) {
			case 'section': {
				const item = new vscode.TreeItem(
					node.label,
					node.section === 'branches'
						? vscode.TreeItemCollapsibleState.Expanded
						: vscode.TreeItemCollapsibleState.Collapsed
				);
				item.iconPath = new vscode.ThemeIcon(
					{
						branches: 'git-branch',
						remotes: 'cloud',
						tags: 'tag',
						stashes: 'archive',
						submodules: 'file-submodule',
					}[node.section]
				);
				return item;
			}
			case 'folder': {
				const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
				item.iconPath = vscode.ThemeIcon.Folder;
				return item;
			}
			case 'branch': {
				const item = new vscode.TreeItem(node.name.split('/').pop() ?? node.name);
				item.iconPath = new vscode.ThemeIcon(node.current ? 'check' : 'git-branch');
				item.description = node.aheadBehind ?? undefined;
				item.tooltip = `${node.name} — ${node.hash.slice(0, 8)}`;
				item.contextValue = 'localBranch';
				item.command = revealCommand(node.hash);
				return item;
			}
			case 'remoteRoot': {
				const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
				item.iconPath = new vscode.ThemeIcon('cloud');
				return item;
			}
			case 'remoteBranch': {
				const item = new vscode.TreeItem(node.label);
				item.iconPath = new vscode.ThemeIcon('git-branch');
				item.tooltip = `${node.fullName} — ${node.hash.slice(0, 8)}`;
				item.contextValue = 'remoteBranch';
				item.command = revealCommand(node.hash);
				return item;
			}
			case 'tag': {
				const item = new vscode.TreeItem(node.name);
				item.iconPath = new vscode.ThemeIcon('tag');
				item.description = node.hash.slice(0, 8);
				item.contextValue = 'tag';
				item.command = revealCommand(node.hash);
				return item;
			}
			case 'stash': {
				const item = new vscode.TreeItem(node.name);
				item.iconPath = new vscode.ThemeIcon('archive');
				item.description = node.message;
				item.tooltip = node.message;
				item.contextValue = 'stash';
				item.command = revealCommand(node.hash);
				return item;
			}
			case 'submodule': {
				const item = new vscode.TreeItem(node.path);
				item.iconPath = new vscode.ThemeIcon('file-submodule');
				item.description = node.hash;
				item.tooltip = `${node.path} @ ${node.hash}`;
				item.contextValue = 'submodule';
				return item;
			}
		}
	}
}

function revealCommand(hash: string): vscode.Command | undefined {
	if (hash === '') return undefined;
	return {
		command: 'git-octopus.revealCommit',
		title: 'Reveal in Graph',
		arguments: [hash],
	};
}
