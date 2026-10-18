import { execFile, spawn } from 'node:child_process';
import { chmodSync, cpSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CredentialPrompt, CredentialRequest } from '../../app/ports/credentialPrompt.js';
import { AskpassServer, ensureExecutable } from './askpassServer.js';

const HELPER_SOURCE = path.resolve(__dirname, '../../../media/askpass');
const CONTEXT = { cwd: '/work/octo-repo', operation: 'push', listHosts: ['example.invalid'] };

interface Asked {
	request: CredentialRequest;
	signal: AbortSignal;
}

/** A port that records every question and answers from a queue (undefined once it runs dry). */
function fakePrompt(listAnswers: (string | undefined | Error)[] = []): {
	port: CredentialPrompt;
	listAsked: Asked[];
} {
	const listAsked: Asked[] = [];
	const port: CredentialPrompt = {
		ask: (request, signal) => {
			listAsked.push({ request, signal });
			const answer = listAnswers.shift();
			return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
		},
	};
	return { port, listAsked };
}

/** Run askpass-main.cjs exactly as askpass.sh would, against the lease's environment. */
function runClient(
	mapEnv: Record<string, string>,
	prompt: string
): Promise<{ code: number; stdout: string }> {
	return new Promise((resolve) => {
		execFile(
			process.execPath,
			[mapEnv.GIT_OCTOPUS_ASKPASS_MAIN, prompt],
			{ env: { ...process.env, ...mapEnv } },
			(error, stdout) => {
				const code =
					error && typeof (error as { code?: unknown }).code === 'number'
						? ((error as { code?: number }).code ?? 1)
						: error
							? 1
							: 0;
				resolve({ code, stdout });
			}
		);
	});
}

async function waitUntil(done: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 400 && !done(); attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	expect(done()).toBe(true);
}

describe('AskpassServer', () => {
	let helperDir: string;
	let server: AskpassServer | null = null;

	beforeEach(() => {
		helperDir = path.join(mkdtempSync(path.join(tmpdir(), 'gg-srv-')), 'helper dir');
		cpSync(HELPER_SOURCE, helperDir, { recursive: true });
	});

	afterEach(() => {
		server?.dispose();
		server = null;
		rmSync(path.dirname(helperDir), { recursive: true, force: true });
	});

	it('finds its helper from the directory it is given and points the lease at it', async () => {
		server = new AskpassServer(helperDir, fakePrompt().port, '/app/bin/node');
		await server.start();
		const { mapEnv } = server.register(CONTEXT);

		expect(mapEnv.GIT_ASKPASS).toBe(path.join(helperDir, 'askpass.sh'));
		expect(mapEnv.SSH_ASKPASS).toBe(path.join(helperDir, 'askpass.sh'));
		expect(mapEnv.GIT_OCTOPUS_ASKPASS_MAIN).toBe(path.join(helperDir, 'askpass-main.cjs'));
		expect(mapEnv.GIT_OCTOPUS_ASKPASS_NODE).toBe('/app/bin/node');
		expect(mapEnv.GIT_OCTOPUS_ASKPASS_HANDLE).toBe(server.handlePath);
	});

	it('runs the helper under the host executable unless told otherwise', async () => {
		server = new AskpassServer(helperDir, fakePrompt().port);
		await server.start();
		expect(server.register(CONTEXT).mapEnv.GIT_OCTOPUS_ASKPASS_NODE).toBe(process.execPath);
	});

	it('restores the exec bit that packaging dropped', async () => {
		const script = path.join(helperDir, 'askpass.sh');
		chmodSync(script, 0o644);
		server = new AskpassServer(helperDir, fakePrompt().port);
		await server.start();
		expect(statSync(script).mode & 0o111).not.toBe(0);
	});

	it('starts from a read-only install whose script is already executable', async () => {
		const ops = {
			chmod: () => Promise.reject(new Error('EROFS: read-only file system')),
			access: () => Promise.resolve(),
		};
		await expect(ensureExecutable('/Applications/Git Octopus.app/askpass.sh', ops)).resolves.toBe(
			undefined
		);
	});

	it('refuses to start when the script can be neither changed nor run', async () => {
		const ops = {
			chmod: () => Promise.reject(new Error('EROFS: read-only file system')),
			access: () => Promise.reject(new Error('EACCES')),
		};
		await expect(ensureExecutable('/Applications/Git Octopus.app/askpass.sh', ops)).rejects.toThrow(
			/askpass\.sh cannot be run.*EROFS/
		);
	});

	it('refuses to start when the helper is not where it was told', async () => {
		server = new AskpassServer(path.join(helperDir, 'missing'), fakePrompt().port);
		await expect(server.start()).rejects.toThrow();
	});

	it('asks through the port with a title built from trusted context only', async () => {
		const { port, listAsked } = fakePrompt(['hunter2']);
		server = new AskpassServer(helperDir, port);
		await server.start();
		const { nonce, mapEnv } = server.register(CONTEXT);

		const result = await runClient(mapEnv, "Password for 'https://user@example.invalid': ");
		server.release(nonce);

		expect(result).toEqual({ code: 0, stdout: 'hunter2' });
		expect(listAsked).toHaveLength(1);
		expect(listAsked[0].request).toEqual({
			title: 'Git Octopus: push — octo-repo → example.invalid',
			prompt: "Password for 'https://user@example.invalid':",
			secret: true,
		});
	});

	it('keeps whatever git wrote out of the title and shows it as plain text', async () => {
		const { port, listAsked } = fakePrompt(['x']);
		server = new AskpassServer(helperDir, port);
		await server.start();
		const { mapEnv } = server.register(CONTEXT);

		const hostile =
			'Username for <img src=x onerror=alert(1)>\u001b[31m — Git Octopus: fetch → evil';
		await runClient(mapEnv, hostile);

		const [{ request }] = listAsked;
		expect(request.title).toBe('Git Octopus: push — octo-repo → example.invalid');
		expect(request.prompt).toBe(
			'Username for <img src=x onerror=alert(1)> [31m — Git Octopus: fetch → evil'
		);
	});

	it('masks every answer except a positively identified username', async () => {
		const { port, listAsked } = fakePrompt(['a', 'b', 'yes', 'c']);
		server = new AskpassServer(helperDir, port);
		await server.start();
		const { mapEnv } = server.register(CONTEXT);

		await runClient(mapEnv, "Username for 'https://example.invalid': ");
		await runClient(mapEnv, "Password for 'https://u@example.invalid': ");
		await runClient(mapEnv, 'Are you sure you want to continue connecting (yes/no)? ');
		await runClient(mapEnv, 'Verification code: ');

		expect(listAsked.map((asked) => asked.request.secret)).toEqual([false, true, true, true]);
	});

	it('turns a cancelled prompt into a refusal with nothing printed', async () => {
		const { port } = fakePrompt([undefined]);
		server = new AskpassServer(helperDir, port);
		await server.start();
		const { mapEnv } = server.register(CONTEXT);

		expect(await runClient(mapEnv, 'Password: ')).toEqual({ code: 1, stdout: '' });
	});

	it('survives a port that throws, without echoing what it threw', async () => {
		const { port } = fakePrompt([new Error('dialog crashed with hunter2'), 'next']);
		server = new AskpassServer(helperDir, port);
		await server.start();
		const { mapEnv } = server.register(CONTEXT);

		const failed = await runClient(mapEnv, 'Password: ');
		expect(failed).toEqual({ code: 1, stdout: '' });

		const next = await runClient(mapEnv, 'Password: ');
		expect(next).toEqual({ code: 0, stdout: 'next' });
	});

	it('aborts the signal handed to the port once the asking process is gone', async () => {
		const listAsked: Asked[] = [];
		const port: CredentialPrompt = {
			ask: (request, signal) => {
				listAsked.push({ request, signal });
				return new Promise(() => undefined);
			},
		};
		server = new AskpassServer(helperDir, port);
		await server.start();
		const { mapEnv } = server.register(CONTEXT);

		const child = spawn(process.execPath, [mapEnv.GIT_OCTOPUS_ASKPASS_MAIN, 'Password: '], {
			env: { ...process.env, ...mapEnv },
		});
		await waitUntil(() => listAsked.length > 0);
		expect(listAsked[0].signal.aborted).toBe(false);

		child.kill();
		await waitUntil(() => listAsked[0].signal.aborted);
	});
});
