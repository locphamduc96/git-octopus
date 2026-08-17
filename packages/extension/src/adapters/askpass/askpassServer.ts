import * as vscode from 'vscode';
import { chmod } from 'node:fs/promises';
import * as path from 'node:path';
import type { AskpassBridge, GitAuthContext } from '../../core/git/GitExecutor.js';
import { AskpassCore, type PromptRequest } from './askpassCore.js';

/**
 * The vscode face of the askpass bridge: owns an {@link AskpassCore} and answers its questions
 * with real input UI. The title of every prompt is built from the trusted auth context — the
 * operation and hosts this extension resolved before spawning git — never from the prompt text,
 * which whatever is on the other end of the connection controls.
 */
export class AskpassServer implements AskpassBridge, vscode.Disposable {
	private readonly core: AskpassCore;
	private readonly scriptPath: string;

	public constructor(extensionPath: string) {
		const dir = path.join(extensionPath, 'media', 'askpass');
		this.scriptPath = path.join(dir, 'askpass.sh');
		this.core = new AskpassCore(
			{
				scriptPath: this.scriptPath,
				mainPath: path.join(dir, 'askpass-main.cjs'),
				// The editor's own executable, run as node by askpass.sh (ELECTRON_RUN_AS_NODE).
				nodePath: process.execPath,
			},
			(request) => this.prompt(request)
		);
	}

	/** Must complete before any executor holds this as its bridge. */
	public async start(): Promise<void> {
		// The exec bit does not survive VSIX packaging, so it is restored on every start.
		await chmod(this.scriptPath, 0o755);
		await this.core.start();
	}

	public register(context: GitAuthContext): { nonce: string; mapEnv: Record<string, string> } {
		return this.core.register(context);
	}

	public release(nonce: string): void {
		this.core.release(nonce);
	}

	public dispose(): void {
		this.core.dispose();
	}

	private async prompt(request: PromptRequest): Promise<string | undefined> {
		const repoName = path.basename(request.context.cwd);
		const hosts = request.context.listHosts.join(', ') || 'remote';
		const title = `Git Octopus: ${request.context.operation} — ${repoName} → ${hosts}`;
		if (request.kind === 'confirm') {
			const pick = await vscode.window.showWarningMessage(
				`${title}\n\n${request.display}`,
				{ modal: true },
				'Yes',
				'No'
			);
			if (pick === 'Yes') return 'yes';
			if (pick === 'No') return 'no';
			return undefined;
		}
		return vscode.window.showInputBox({
			title,
			prompt: request.display,
			// Everything that is not a positively identified username stays masked.
			password: request.kind !== 'username',
			ignoreFocusOut: true,
		});
	}
}
