import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AskpassServer } from '@git-octopus/host/adapters/askpass/askpassServer';
import type { CredentialRequest } from '@git-octopus/host/app/ports/credentialPrompt';
import { buildDesktopAskpassEnv } from './askpassEnv.js';

const APP_BINARY = '/Applications/Git Octopus.app/Contents/MacOS/Git Octopus';
const HELPER_DIR = '/Applications/Git Octopus.app/Contents/Resources/askpass';
const HELPER_SOURCE = path.resolve(__dirname, '../../../host/media/askpass');

describe('buildDesktopAskpassEnv', () => {
	it('runs the helper under the app binary as node, against the given handle and nonce', () => {
		expect(
			buildDesktopAskpassEnv({
				helperDir: HELPER_DIR,
				handle: '/tmp/gg-ask-x/s',
				nonce: 'n0nce',
				execPath: APP_BINARY,
				display: ':1',
			})
		).toEqual({
			GIT_ASKPASS: `${HELPER_DIR}/askpass.sh`,
			SSH_ASKPASS: `${HELPER_DIR}/askpass.sh`,
			SSH_ASKPASS_REQUIRE: 'force',
			GIT_OCTOPUS_ASKPASS_NODE: APP_BINARY,
			GIT_OCTOPUS_ASKPASS_MAIN: `${HELPER_DIR}/askpass-main.cjs`,
			GIT_OCTOPUS_ASKPASS_HANDLE: '/tmp/gg-ask-x/s',
			GIT_OCTOPUS_ASKPASS_NONCE: 'n0nce',
			ELECTRON_RUN_AS_NODE: '1',
		});
	});

	it("defaults to the running process's own executable", () => {
		const mapEnv = buildDesktopAskpassEnv({ helperDir: HELPER_DIR, handle: 'h', nonce: 'n' });
		expect(mapEnv.GIT_OCTOPUS_ASKPASS_NODE).toBe(process.execPath);
		expect(mapEnv.ELECTRON_RUN_AS_NODE).toBe('1');
	});

	it('supplies a DISPLAY for older OpenSSH only when there is none', () => {
		const base = { helperDir: HELPER_DIR, handle: 'h', nonce: 'n' };
		expect(buildDesktopAskpassEnv({ ...base, display: '' }).DISPLAY).toBe(':0');
		expect(buildDesktopAskpassEnv({ ...base, display: ':1' }).DISPLAY).toBeUndefined();
	});
});

describe('the environment drives the real helper', () => {
	let helperDir: string;
	let server: AskpassServer | null = null;

	beforeEach(() => {
		helperDir = path.join(mkdtempSync(path.join(tmpdir(), 'gg-desk-')), 'Git Octopus.app');
		cpSync(HELPER_SOURCE, helperDir, { recursive: true });
	});

	afterEach(() => {
		server?.dispose();
		server = null;
		rmSync(path.dirname(helperDir), { recursive: true, force: true });
	});

	it('gets the answer of a server that was handed the same helper directory', async () => {
		const listAsked: CredentialRequest[] = [];
		server = new AskpassServer(helperDir, {
			ask: (request) => {
				listAsked.push(request);
				return Promise.resolve('hunter2');
			},
		});
		await server.start();
		const { nonce } = server.register({
			cwd: '/work/octo-repo',
			operation: 'fetch',
			listHosts: ['example.invalid'],
		});
		const mapEnv = buildDesktopAskpassEnv({
			helperDir,
			handle: server.handlePath ?? '',
			nonce,
		});

		// How git launches GIT_ASKPASS: through the shell, with the prompt as the argument.
		const stdout = await new Promise<string>((resolve, reject) => {
			execFile(
				'/bin/sh',
				['-c', '"$GIT_ASKPASS" "$0"', "Password for 'https://octo@example.invalid': "],
				{ env: { ...process.env, ...mapEnv } },
				(error, out) => (error ? reject(error) : resolve(out))
			);
		});

		expect(stdout).toBe('hunter2');
		expect(listAsked).toEqual([
			{
				title: 'Git Octopus: fetch — octo-repo → example.invalid',
				prompt: "Password for 'https://octo@example.invalid':",
				secret: true,
			},
		]);
	});
});
