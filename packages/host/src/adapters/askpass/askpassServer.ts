import { chmod } from 'node:fs/promises';
import * as path from 'node:path';
import type { CredentialPrompt } from '../../app/ports/credentialPrompt.js';
import type { AskpassBridge, GitAuthContext } from '../../core/git/GitExecutor.js';
import { AskpassCore, type PromptRequest } from './askpassCore.js';
import { askpassHelperPaths } from './askpassEnv.js';

/**
 * The shell-neutral face of the askpass bridge: owns an {@link AskpassCore} and puts its
 * questions to the user through a {@link CredentialPrompt}. The title of every prompt is built
 * from the trusted auth context — the operation and hosts the host resolved before spawning git —
 * never from the prompt text, which whatever is on the other end of the connection controls.
 */
export class AskpassServer implements AskpassBridge {
	private readonly core: AskpassCore;
	private readonly scriptPath: string;

	/**
	 * @param helperDir directory holding `askpass.sh` and `askpass-main.cjs`, as shipped by the shell.
	 * @param nodePath the binary the helper runs under — the host app's own executable by default,
	 *   which `askpass.sh` runs as node with `ELECTRON_RUN_AS_NODE`.
	 */
	public constructor(
		helperDir: string,
		private readonly credentialPrompt: CredentialPrompt,
		nodePath: string = process.execPath
	) {
		const { scriptPath, mainPath } = askpassHelperPaths(helperDir);
		this.scriptPath = scriptPath;
		this.core = new AskpassCore({ scriptPath, mainPath, nodePath }, (request) =>
			this.prompt(request)
		);
	}

	/** The listening socket, once started — what a lease's environment points the helper at. */
	public get handlePath(): string | null {
		return this.core.handlePath;
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
		// Everything that is not a positively identified username stays masked.
		return await this.credentialPrompt.ask(
			{ title, prompt: request.display, secret: request.kind !== 'username' },
			request.signal
		);
	}
}
