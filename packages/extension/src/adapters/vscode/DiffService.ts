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

	private buildUri(rev: string, filePath: string, cwd: string): vscode.Uri {
		return vscode.Uri.from({
			scheme: DiffService.scheme,
			path: filePath,
			query: JSON.stringify({ rev, path: filePath, cwd }),
		});
	}
}
