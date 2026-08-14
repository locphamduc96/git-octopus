import * as vscode from 'vscode';
import * as path from 'node:path';
import type { GitExecutor } from '../../core/git/GitExecutor.js';
import { getFileAtRev } from '../../core/git/gitService.js';

/**
 * Opens VS Code diff editors for a file at a commit vs its parent, and serves the file content
 * at any revision through a virtual `git-octopus:` document scheme.
 */
export class DiffService implements vscode.TextDocumentContentProvider {
	public static readonly scheme = 'git-octopus';

	public constructor(private readonly executor: GitExecutor) {}

	public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const { rev, path: filePath, cwd } = JSON.parse(uri.query) as {
			rev: string;
			path: string;
			cwd: string;
		};
		return getFileAtRev(this.executor, cwd, rev, filePath);
	}

	public async openDiff(hash: string, filePath: string, cwd: string): Promise<void> {
		const left = this.buildUri(`${hash}^`, filePath, cwd);
		const right = this.buildUri(hash, filePath, cwd);
		const title = `${path.basename(filePath)} (${hash.slice(0, 7)})`;
		await vscode.commands.executeCommand('vscode.diff', left, right, title);
	}

	/** Diff a file between two arbitrary commits. */
	public async openCompareDiff(
		fromHash: string,
		toHash: string,
		filePath: string,
		cwd: string
	): Promise<void> {
		const left = this.buildUri(fromHash, filePath, cwd);
		const right = this.buildUri(toHash, filePath, cwd);
		const title = `${path.basename(filePath)} (${fromHash.slice(0, 7)} ↔ ${toHash.slice(0, 7)})`;
		await vscode.commands.executeCommand('vscode.diff', left, right, title);
	}

	/** Diff a working-tree file against HEAD; the right side is the real file on disk. */
	public async openWorkingDiff(filePath: string, cwd: string): Promise<void> {
		const left = this.buildUri('HEAD', filePath, cwd);
		const right = vscode.Uri.file(path.join(cwd, filePath));
		await vscode.commands.executeCommand(
			'vscode.diff',
			left,
			right,
			`${path.basename(filePath)} (Working Tree)`
		);
	}

	/** Open the file itself: the copy on disk, or a read-only view of it at `rev`. */
	public async openFile(filePath: string, cwd: string, rev?: string): Promise<void> {
		const uri = rev
			? this.buildUri(rev, filePath, cwd)
			: vscode.Uri.file(path.join(cwd, filePath));
		await vscode.commands.executeCommand('vscode.open', uri);
	}

	private buildUri(rev: string, filePath: string, cwd: string): vscode.Uri {
		return vscode.Uri.from({
			scheme: DiffService.scheme,
			path: filePath,
			query: JSON.stringify({ rev, path: filePath, cwd }),
		});
	}
}
