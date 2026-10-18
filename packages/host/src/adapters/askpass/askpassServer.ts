import { constants } from 'node:fs';
import { access, chmod } from 'node:fs/promises';
import * as path from 'node:path';
import type { CredentialPrompt } from '../../app/ports/credentialPrompt.js';
import type { AskpassBridge, GitAuthContext } from '../../core/git/GitExecutor.js';
import { AskpassCore, type PromptRequest } from './askpassCore.js';
import { askpassHelperPaths } from './askpassEnv.js';

export interface ExecutableOps {
	chmod: (file: string, mode: number) => Promise<void>;
	access: (file: string, mode: number) => Promise<void>;
}

/**
 * Makes sure git can run `file`. The exec bit does not survive VSIX packaging, so it is restored
 * here; where the file cannot be changed at all (a packaged, read-only app, whose bit was set when
 * it was built) that is fine as long as it is already executable.
 */
export async function ensureExecutable(
	file: string,
	ops: ExecutableOps = { chmod, access }
): Promise<void> {
	try {
		await ops.chmod(file, 0o755);
	} catch (error) {
		try {
			await ops.access(file, constants.X_OK);
		} catch {
			throw new Error(
				`The askpass helper ${file} cannot be run and its mode cannot be changed: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
	}
}

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
		await ensureExecutable(this.scriptPath);
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
