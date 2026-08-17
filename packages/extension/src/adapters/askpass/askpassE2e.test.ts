import { execFile } from 'node:child_process';
import { chmodSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AskpassCore, type PromptRequest } from './askpassCore';

/**
 * The whole chain, with nothing faked in the middle: a real `git ls-remote` against an HTTP
 * server that demands Basic auth → git runs the real `askpass.sh` (from a directory with a
 * space in its name, as an installed extension path may have) → the editor-node client → the
 * unix socket → the prompt handler. The server then verifies the Authorization header carries
 * exactly what the handler answered.
 */
describe('askpass end to end', () => {
	let server: http.Server;
	let port = 0;
	let scriptDir: string;
	let core: AskpassCore;
	const listPrompts: PromptRequest[] = [];
	let authHeader: string | null = null;

	beforeAll(async () => {
		// An installed extension can live under a path with spaces — prove the launcher quotes.
		scriptDir = path.join(mkdtempSync(path.join(tmpdir(), 'gg-e2e-')), 'with space');
		cpSync(path.resolve(__dirname, '../../../media/askpass'), scriptDir, { recursive: true });
		chmodSync(path.join(scriptDir, 'askpass.sh'), 0o755);

		server = http.createServer((request, response) => {
			if (!request.headers.authorization) {
				response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="e2e"' });
				response.end();
				return;
			}
			authHeader = request.headers.authorization;
			// Still refuse: the test only needs to see the credentials arrive.
			response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="e2e"' });
			response.end();
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		port = (server.address() as { port: number }).port;

		core = new AskpassCore(
			{
				scriptPath: path.join(scriptDir, 'askpass.sh'),
				mainPath: path.join(scriptDir, 'askpass-main.cjs'),
				nodePath: process.execPath,
			},
			async (request) => {
				listPrompts.push(request);
				return request.kind === 'username' ? 'octo-user' : 'octo-pass';
			}
		);
		await core.start();
	});

	afterAll(() => {
		core.dispose();
		server.close();
		rmSync(path.dirname(scriptDir), { recursive: true, force: true });
	});

	it('feeds a real git the credentials the prompt handler answered', async () => {
		const { nonce, mapEnv } = core.register({
			cwd: tmpdir(),
			operation: 'fetch',
			listHosts: ['127.0.0.1'],
		});
		await new Promise<void>((resolve) => {
			execFile(
				'git',
				['ls-remote', `http://127.0.0.1:${String(port)}/repo.git`],
				{
					cwd: tmpdir(),
					env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...mapEnv },
					timeout: 15_000,
				},
				() => resolve() // git fails (server always 401s) — expected.
			);
		});
		core.release(nonce);

		// git asked for a username, then a password, through the real script chain.
		const listKinds = listPrompts.map((prompt) => prompt.kind);
		expect(listKinds).toContain('username');
		expect(listKinds).toContain('secret');
		// And what the handler answered is exactly what reached the server.
		const expected = `Basic ${Buffer.from('octo-user:octo-pass').toString('base64')}`;
		expect(authHeader).toBe(expected);
	});
});
