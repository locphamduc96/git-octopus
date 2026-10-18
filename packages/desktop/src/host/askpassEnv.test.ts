import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AskpassServer } from '@git-octopus/host/adapters/askpass/askpassServer';
import type { CredentialRequest } from '@git-octopus/host/app/ports/credentialPrompt';
import { createDesktopAskpass, desktopAskpassHelperDir, unpackedPath } from './askpassEnv.js';

const APP_BINARY = '/Applications/Git Octopus.app/Contents/MacOS/Git Octopus';
const PACKED_DIST = '/Applications/Git Octopus.app/Contents/Resources/app.asar/dist';
const HELPER_SOURCE = path.resolve(__dirname, '../../../host/media/askpass');
const CONTEXT = { cwd: '/work/octo-repo', operation: 'fetch', listHosts: ['example.invalid'] };

describe('unpackedPath', () => {
	it('moves a path inside the archive to the unpacked folder beside it', () => {
		expect(unpackedPath(`${PACKED_DIST}/askpass/askpass.sh`)).toBe(
			'/Applications/Git Octopus.app/Contents/Resources/app.asar.unpacked/dist/askpass/askpass.sh'
		);
	});

	it('leaves a path outside any archive as it was', () => {
		expect(unpackedPath('/repo/packages/desktop/dist/askpass')).toBe(
			'/repo/packages/desktop/dist/askpass'
		);
		expect(unpackedPath('/Applications/app.asarx/dist')).toBe('/Applications/app.asarx/dist');
	});

	it('does not touch a path that is already unpacked', () => {
		const unpacked = '/A/Resources/app.asar.unpacked/dist/askpass';
		expect(unpackedPath(unpacked)).toBe(unpacked);
	});
});

describe('desktopAskpassHelperDir', () => {
	it('is the askpass folder of the dist, taken out of the archive when packaged', () => {
		expect(desktopAskpassHelperDir('/repo/packages/desktop/dist')).toBe(
			'/repo/packages/desktop/dist/askpass'
		);
		expect(desktopAskpassHelperDir(PACKED_DIST)).toBe(
			'/Applications/Git Octopus.app/Contents/Resources/app.asar.unpacked/dist/askpass'
		);
	});
});

describe('the desktop askpass bridge', () => {
	let distDir: string;
	let server: AskpassServer | null = null;

	beforeEach(() => {
		distDir = path.join(mkdtempSync(path.join(tmpdir(), 'gg-desk-')), 'dist');
		cpSync(HELPER_SOURCE, path.join(distDir, 'askpass'), { recursive: true });
	});

	afterEach(() => {
		server?.dispose();
		server = null;
		rmSync(path.dirname(distDir), { recursive: true, force: true });
	});

	it('hands git the helper and the app binary, and keeps ELECTRON_RUN_AS_NODE out of git', async () => {
		server = createDesktopAskpass({
			distDir,
			appBinary: APP_BINARY,
			prompt: { ask: () => Promise.resolve(undefined) },
		});
		await server.start();
		const { mapEnv } = server.register(CONTEXT);

		expect(mapEnv.GIT_ASKPASS).toBe(path.join(distDir, 'askpass', 'askpass.sh'));
		expect(mapEnv.SSH_ASKPASS).toBe(path.join(distDir, 'askpass', 'askpass.sh'));
		expect(mapEnv.GIT_OCTOPUS_ASKPASS_MAIN).toBe(path.join(distDir, 'askpass', 'askpass-main.cjs'));
		expect(mapEnv.GIT_OCTOPUS_ASKPASS_NODE).toBe(APP_BINARY);
		expect(mapEnv.GIT_OCTOPUS_ASKPASS_HANDLE).toBe(server.handlePath);
		expect(mapEnv).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
	});

	it('gets the answer of the prompt when the helper is run the way git runs it', async () => {
		const listAsked: CredentialRequest[] = [];
		server = createDesktopAskpass({
			distDir,
			appBinary: process.execPath,
			prompt: {
				ask: (request) => {
					listAsked.push(request);
					return Promise.resolve('hunter2');
				},
			},
		});
		await server.start();
		const { nonce, mapEnv } = server.register(CONTEXT);

		// How git launches GIT_ASKPASS: through the shell, with the prompt as the argument.
		const stdout = await new Promise<string>((resolve, reject) => {
			execFile(
				'/bin/sh',
				['-c', '"$GIT_ASKPASS" "$0"', "Password for 'https://octo@example.invalid': "],
				{ env: { ...process.env, ...mapEnv } },
				(error, out) => (error ? reject(error) : resolve(out))
			);
		});
		server.release(nonce);

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
