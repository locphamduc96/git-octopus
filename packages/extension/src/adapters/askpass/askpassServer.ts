import * as vscode from 'vscode';
import { chmod } from 'node:fs/promises';
import * as path from 'node:path';
import type { AskpassBridge, GitAuthContext } from '../../core/git/GitExecutor.js';
import { AskpassCore, type PromptRequest } from './askpassCore.js';
import { CONFIRM_NO, CONFIRM_YES } from './askpassProtocol.js';

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
		// Every prompt is taken down the moment its git process is gone: one that outlived its
		// asker can only collect an answer nobody will read, and while it is up the next command's
		// prompt is behind it.
		return this.whileAsking(request, (token) =>
			request.kind === 'confirm'
				? this.askConfirm(title, request.display, token)
				: this.askText(title, request, token)
		);
	}

	/** Run `ask` under a cancellation token wired to the request's signal, and always clean up. */
	private async whileAsking(
		request: PromptRequest,
		ask: (token: vscode.CancellationToken) => Thenable<string | undefined>
	): Promise<string | undefined> {
		const cancel = new vscode.CancellationTokenSource();
		const onAbort = (): void => cancel.cancel();
		request.signal.addEventListener('abort', onAbort, { once: true });
		try {
			return await ask(cancel.token);
		} finally {
			request.signal.removeEventListener('abort', onAbort);
			cancel.dispose();
		}
	}

	/**
	 * A yes/no question, asked with a quick pick rather than a modal dialog.
	 *
	 * A modal cannot be dismissed by anything but the user, so one left behind by a timed-out
	 * prompt sits over the window and blocks the next authentication prompt outright. The quick
	 * pick takes a cancellation token and goes away on its own. It is still native editor chrome,
	 * like the input box the passwords use — nothing about this question reaches the webview.
	 */
	private async askConfirm(
		title: string,
		display: string,
		token: vscode.CancellationToken
	): Promise<string | undefined> {
		const pick = await vscode.window.showQuickPick(
			// Refusal first, so the highlighted answer to a question the user did not expect is the
			// one that changes nothing.
			[
				{ label: 'No', description: 'Refuse and stop the operation', value: CONFIRM_NO },
				{ label: 'Yes', description: 'Allow the operation to continue', value: CONFIRM_YES },
			],
			{ title, placeHolder: display, ignoreFocusOut: true },
			token
		);
		return pick?.value;
	}

	private askText(
		title: string,
		request: PromptRequest,
		token: vscode.CancellationToken
	): Thenable<string | undefined> {
		return vscode.window.showInputBox(
			{
				title,
				prompt: request.display,
				// Everything that is not a positively identified username stays masked.
				password: request.kind !== 'username',
				ignoreFocusOut: true,
			},
			token
		);
	}
}
