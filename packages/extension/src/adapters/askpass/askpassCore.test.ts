import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AskpassCore, type PromptRequest } from './askpassCore';

const MAIN = path.resolve(__dirname, '../../../media/askpass/askpass-main.cjs');

/** Run askpass-main.cjs exactly as askpass.sh would, against `handle` with `nonce`. */
function runClient(
	handle: string,
	nonce: string,
	prompt: string
): Promise<{ code: number; stdout: string }> {
	return new Promise((resolve) => {
		execFile(
			process.execPath,
			[MAIN, prompt],
			{
				env: {
					...process.env,
					GIT_OCTOPUS_ASKPASS_HANDLE: handle,
					GIT_OCTOPUS_ASKPASS_NONCE: nonce,
				},
			},
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

function makeCore(
	handler: (request: PromptRequest) => Promise<string | undefined>,
	promptTimeoutMs?: number
): AskpassCore {
	return new AskpassCore(
		{ scriptPath: '/x/askpass.sh', mainPath: MAIN, nodePath: process.execPath, promptTimeoutMs },
		handler
	);
}

const CONTEXT = { cwd: '/repo', operation: 'push', listHosts: ['zalogit2.zing.vn'] };

describe('AskpassCore', () => {
	let core: AskpassCore | null = null;
	afterEach(() => {
		core?.dispose();
		core = null;
	});

	it('answers a client holding a live nonce, and hands the handler trusted context', async () => {
		let seen: PromptRequest | null = null;
		core = makeCore(async (request) => {
			seen = request;
			return 'hunter2';
		});
		await core.start();
		const { nonce } = core.register(CONTEXT);
		const result = await runClient(core.handlePath!, nonce, "Password for 'https://z': ");
		expect(result).toEqual({ code: 0, stdout: 'hunter2' });
		expect(seen!.kind).toBe('secret');
		expect(seen!.context.listHosts).toEqual(['zalogit2.zing.vn']);
	});

	it('refuses a spoofed client without a live nonce', async () => {
		let asked = 0;
		core = makeCore(async () => {
			asked++;
			return 'leak';
		});
		await core.start();
		core.register(CONTEXT);
		const result = await runClient(core.handlePath!, 'not-the-nonce', 'Password: ');
		expect(result.code).toBe(1);
		expect(result.stdout).toBe('');
		expect(asked).toBe(0);
	});

	it('refuses a nonce that was released when its git process closed', async () => {
		core = makeCore(async () => 'leak');
		await core.start();
		const { nonce } = core.register(CONTEXT);
		core.release(nonce);
		const result = await runClient(core.handlePath!, nonce, 'Password: ');
		expect(result.code).toBe(1);
	});

	it('reports cancellation as a refusal so git aborts', async () => {
		core = makeCore(async () => undefined);
		await core.start();
		const { nonce } = core.register(CONTEXT);
		const result = await runClient(core.handlePath!, nonce, 'Password: ');
		expect(result.code).toBe(1);
	});

	it('serialises concurrent prompts and keeps answers with their askers', async () => {
		let active = 0;
		let maxActive = 0;
		core = makeCore(async (request) => {
			active++;
			maxActive = Math.max(maxActive, active);
			await new Promise((resolve) => setTimeout(resolve, 25));
			active--;
			return `answer:${request.display}`;
		});
		await core.start();
		const { nonce } = core.register(CONTEXT);
		const [first, second] = await Promise.all([
			runClient(core.handlePath!, nonce, 'Password one'),
			runClient(core.handlePath!, nonce, 'Password two'),
		]);
		expect(maxActive).toBe(1);
		expect(first.stdout).toBe('answer:Password one');
		expect(second.stdout).toBe('answer:Password two');
	});

	it('drops oversized frames before they reach the handler', async () => {
		let asked = 0;
		core = makeCore(async () => {
			asked++;
			return 'x';
		});
		await core.start();
		const { nonce } = core.register(CONTEXT);
		const result = await runClient(core.handlePath!, nonce, 'p'.repeat(10_000));
		expect(result.code).toBe(1);
		expect(asked).toBe(0);
	});

	it('drops malformed frames', async () => {
		core = makeCore(async () => 'x');
		await core.start();
		core.register(CONTEXT);
		const handle = core.handlePath!;
		const code = await new Promise<number>((resolve) => {
			const socket = net.connect(handle, () => socket.write('{not json\n'));
			socket.on('close', () => resolve(1));
			socket.on('error', () => resolve(1));
		});
		expect(code).toBe(1);
	});

	it('keeps its runtime directory private (0700)', async () => {
		core = makeCore(async () => 'x');
		await core.start();
		const dir = path.dirname(core.handlePath!);
		expect(statSync(dir).mode & 0o777).toBe(0o700);
	});

	it('times out an unanswered prompt instead of holding git forever', async () => {
		core = makeCore(() => new Promise(() => undefined), 100);
		await core.start();
		const { nonce } = core.register(CONTEXT);
		const result = await runClient(core.handlePath!, nonce, 'Password: ');
		expect(result.code).toBe(1);
	});
});
