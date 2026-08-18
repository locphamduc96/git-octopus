import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { GitAuthContext } from '../../core/git/GitExecutor.js';
import {
	buildReply,
	classifyPrompt,
	decodeFrame,
	encodeFrame,
	MAX_FRAME_BYTES,
} from './askpassProtocol.js';
import type { PromptKind } from './askpassProtocol.js';

/** A question on its way to the user, carrying only trusted context plus sanitized display text. */
export interface PromptRequest {
	context: GitAuthContext;
	kind: PromptKind;
	display: string;
	/**
	 * Aborted once the asking git process is gone — timed out, killed, or finished another way.
	 * A handler showing UI should close it: nothing it collects after this can be delivered.
	 */
	signal: AbortSignal;
}

/** Resolves when the connection behind a prompt gives up, so a turn can stop waiting on its UI. */
function whenAborted(signal: AbortSignal): Promise<undefined> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve(undefined);
			return;
		}
		signal.addEventListener('abort', () => resolve(undefined), { once: true });
	});
}

/** Answers a prompt, or returns undefined to refuse it (user cancelled). */
export type PromptHandler = (request: PromptRequest) => Promise<string | undefined>;

interface Lease {
	context: GitAuthContext;
	expiresAt: number;
}

/** A lease dies with its git process, but never outlives this even if the process hangs. */
const LEASE_TTL_MS = 10 * 60 * 1000;
/** How long a question may sit unanswered before the connection is refused. */
const PROMPT_TIMEOUT_MS = 5 * 60 * 1000;
/** More simultaneous askers than this is not git at work — refuse the excess. */
const MAX_CONNECTIONS = 8;

export interface AskpassCoreOptions {
	/** Absolute path of askpass.sh, handed to git/ssh as the program to run. */
	scriptPath: string;
	/** Absolute path of askpass-main.cjs, run by the script under `nodePath`. */
	mainPath: string;
	/** The node binary the script uses — the editor's own executable run as node. */
	nodePath: string;
	promptTimeoutMs?: number;
}

/**
 * The extension-host half of the askpass bridge, kept free of vscode imports so it can be
 * driven end-to-end in tests: a unix-socket server in a private 0700 directory, answering only
 * requests that carry the live nonce of a git invocation this extension spawned.
 *
 * Security shape (see feature-039 plan): the environment — and so the socket handle and nonce —
 * is granted per network invocation and revoked when that process closes. Requests are answered
 * strictly one at a time through `promptHandler`, so two concurrent commands queue instead of
 * racing the UI, and every answer a caller gets was typed by the user for a prompt they saw.
 */
export class AskpassCore {
	private server: net.Server | null = null;
	private runtimeDir: string | null = null;
	private socketPath: string | null = null;
	private readonly mapLeases = new Map<string, Lease>();
	private queueTail: Promise<unknown> = Promise.resolve();
	private connections = 0;
	private disposed = false;

	public constructor(
		private readonly options: AskpassCoreOptions,
		private readonly promptHandler: PromptHandler
	) {}

	/** Listening socket path — for tests and diagnostics only; never logged with secrets. */
	public get handlePath(): string | null {
		return this.socketPath;
	}

	public async start(): Promise<void> {
		// A private directory rather than a bare socket in tmpdir: the 0700 mode is the access
		// control, independent of whatever umask the host process inherited.
		const dir = mkdtempSync(path.join(tmpdir(), 'gg-ask-'));
		chmodSync(dir, 0o700);
		this.runtimeDir = dir;
		this.socketPath = path.join(dir, 's');
		const server = net.createServer((socket) => this.serve(socket));
		this.server = server;
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(this.socketPath, () => {
				server.removeListener('error', reject);
				resolve();
			});
		});
	}

	/**
	 * Grant one git invocation the right to ask. Returns the environment to spawn it with and
	 * the nonce to revoke afterwards.
	 */
	public register(context: GitAuthContext): { nonce: string; mapEnv: Record<string, string> } {
		if (!this.socketPath) throw new Error('askpass server is not running');
		const nonce = randomBytes(32).toString('hex');
		this.mapLeases.set(nonce, { context, expiresAt: Date.now() + LEASE_TTL_MS });
		const mapEnv: Record<string, string> = {
			GIT_ASKPASS: this.options.scriptPath,
			SSH_ASKPASS: this.options.scriptPath,
			// OpenSSH ≥ 8.4 honours this; older versions want DISPLAY, provided below.
			SSH_ASKPASS_REQUIRE: 'force',
			GIT_OCTOPUS_ASKPASS_NODE: this.options.nodePath,
			GIT_OCTOPUS_ASKPASS_MAIN: this.options.mainPath,
			GIT_OCTOPUS_ASKPASS_HANDLE: this.socketPath,
			GIT_OCTOPUS_ASKPASS_NONCE: nonce,
		};
		if (!process.env.DISPLAY) mapEnv.DISPLAY = ':0';
		return { nonce, mapEnv };
	}

	public release(nonce: string): void {
		this.mapLeases.delete(nonce);
	}

	public dispose(): void {
		this.disposed = true;
		this.mapLeases.clear();
		this.server?.close();
		this.server = null;
		if (this.runtimeDir) {
			try {
				rmSync(this.runtimeDir, { recursive: true, force: true });
			} catch {
				// tmpdir cleanup is best-effort; the OS reclaims it eventually.
			}
			this.runtimeDir = null;
			this.socketPath = null;
		}
	}

	private serve(socket: net.Socket): void {
		if (this.disposed || this.connections >= MAX_CONNECTIONS) {
			socket.destroy();
			return;
		}
		this.connections++;
		let buffer = '';
		let answered = false;
		const timeoutMs = this.options.promptTimeoutMs ?? PROMPT_TIMEOUT_MS;
		// Destroying the socket ends the git process's wait, but says nothing to the prompt already
		// on screen. Aborting is what releases the queue, so the next command can still ask.
		const abort = new AbortController();
		const timer = setTimeout(() => {
			abort.abort();
			socket.destroy();
		}, timeoutMs);
		const done = (): void => {
			clearTimeout(timer);
			abort.abort();
			this.connections--;
		};
		socket.once('close', done);
		socket.on('error', () => socket.destroy());
		socket.on('data', (chunk: Buffer) => {
			if (answered) return;
			buffer += chunk.toString('utf8');
			if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) {
				socket.destroy();
				return;
			}
			const newline = buffer.indexOf('\n');
			if (newline === -1) return;
			answered = true;
			this.answer(socket, buffer.slice(0, newline), abort.signal);
		});
	}

	private answer(socket: net.Socket, line: string, signal: AbortSignal): void {
		const frame = decodeFrame(line);
		const nonce = typeof frame?.nonce === 'string' ? frame.nonce : null;
		const prompt = typeof frame?.prompt === 'string' ? frame.prompt : null;
		const lease = nonce ? this.mapLeases.get(nonce) : undefined;
		// No live lease — a stray or hostile client, or a request outliving its invocation.
		// Refused without ever reaching the user.
		if (frame === null || prompt === null || !lease || lease.expiresAt < Date.now()) {
			socket.destroy();
			return;
		}
		const { kind, display } = classifyPrompt(prompt);
		const request: PromptRequest = { context: lease.context, kind, display, signal };
		// One question at a time, in arrival order: the previous prompt resolves before the next
		// is shown, whatever order their git processes finish in.
		//
		// The turn also ends when its own asker gives up, whether or not the handler ever answers.
		// Chaining the queue on a handler that outlives its git process — a native input box left
		// open past the timeout — would park every later credential request behind a question
		// nobody can answer any more.
		const turn = this.queueTail.then(async () => {
			if (this.disposed || socket.destroyed || signal.aborted) return;
			const response = await Promise.race([
				this.promptHandler(request).catch(() => undefined),
				whenAborted(signal),
			]);
			if (socket.destroyed || signal.aborted) return;
			socket.end(encodeFrame(buildReply(kind, response)));
		});
		this.queueTail = turn;
	}
}
