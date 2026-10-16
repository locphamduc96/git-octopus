import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitProcessExecutor } from '../../adapters/process/gitProcessExecutor';
import { createTempRepo, type TempRepo } from '../../test/tempRepo';
import { getCommitDetails, getCommits } from './gitService';
import { getSigningConfig, parseGitVersion, setSigningConfig } from './signing';

const run = promisify(execFile);

/**
 * Real git, a real SSH key, made for the test and deleted after. The machine's own config is shut
 * out: a broken global `gpg.format` is fatal to every signature git reads, and this suite must say
 * what the code does, not what the developer's dotfiles do.
 */
describe('commit signing (real git, SSH key)', async () => {
	const version = parseGitVersion((await run('git', ['--version'])).stdout) ?? '0.0';
	const [major, minor] = version.split('.').map(Number);
	const sshSigning = major > 2 || (major === 2 && minor >= 34);

	let repo: TempRepo;
	let keyDir: string;
	let previousGlobal: string | undefined;
	const executor = new GitProcessExecutor();
	const filters = { branch: null, showRemoteBranches: false };

	beforeAll(async () => {
		keyDir = await mkdtemp(path.join(tmpdir(), 'git-octopus-sign-'));
		previousGlobal = process.env.GIT_CONFIG_GLOBAL;
		const globalConfig = path.join(keyDir, 'gitconfig');
		await writeFile(globalConfig, '');
		process.env.GIT_CONFIG_GLOBAL = globalConfig;
		repo = await createTempRepo();
	});

	afterAll(async () => {
		if (previousGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
		else process.env.GIT_CONFIG_GLOBAL = previousGlobal;
		await repo.dispose();
		await rm(keyDir, { recursive: true, force: true });
	});

	it('leaves an unsigned commit without a signature', async () => {
		const hash = await repo.commit('a.txt', 'a\n', 'unsigned');
		const [commit] = await getCommits(
			executor,
			repo.cwd,
			10,
			{ ...filters, showSignatures: true },
			true
		);
		expect(commit.hash).toBe(hash);
		expect(commit).not.toHaveProperty('signature');
		expect((await getCommitDetails(executor, repo.cwd, hash)).signature).toBeUndefined();
	});

	it.skipIf(!sshSigning)('writes signing to the repository config and verifies', async () => {
		const key = path.join(keyDir, 'id');
		await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'test', '-f', key]);
		const publicKey = (await readFile(`${key}.pub`, 'utf8')).trim();
		const signers = path.join(keyDir, 'allowed_signers');
		await writeFile(signers, `test@example.invalid ${publicKey}\n`);

		await setSigningConfig(executor, repo.cwd, {
			'commit.gpgsign': 'true',
			'gpg.format': 'ssh',
			'user.signingkey': `${key}.pub`,
			'gpg.ssh.allowedsignersfile': signers,
		});
		const config = await getSigningConfig(executor, repo.cwd);
		expect(config.mapValues['gpg.format']).toMatchObject({ value: 'ssh', scope: 'local' });
		expect(config.listLocalKeys).toContain('commit.gpgsign');
		expect(await readFile(process.env.GIT_CONFIG_GLOBAL ?? '', 'utf8')).toBe('');

		// `commit.gpgsign` alone is what makes this commit signed: no -S anywhere.
		const hash = await repo.commit('a.txt', 'b\n', 'signed');
		const [signed, unsigned] = await getCommits(
			executor,
			repo.cwd,
			10,
			{ ...filters, showSignatures: true },
			true
		);
		expect(signed.hash).toBe(hash);
		expect(signed.signature).toBe('good');
		expect(unsigned).not.toHaveProperty('signature');

		const details = await getCommitDetails(executor, repo.cwd, hash);
		expect(details.signature).toMatchObject({ status: 'good', signer: 'test@example.invalid' });
		expect(details.signature?.key).toMatch(/^SHA256:/);

		// Off, the walk never asks — no badge without the opt-in.
		const [plain] = await getCommits(executor, repo.cwd, 10, filters, true);
		expect(plain).not.toHaveProperty('signature');

		// A key the signers file does not list still verifies, but is not trusted.
		await writeFile(signers, '');
		const [untrusted] = await getCommits(
			executor,
			repo.cwd,
			10,
			{ ...filters, showSignatures: true },
			true
		);
		expect(untrusted.signature).toBe('untrusted');
	});

	it.skipIf(!sshSigning)('still draws the graph when the gpg config is broken', async () => {
		// The exact line found in a real ~/.gitconfig: fatal to `%G?` on any signed commit.
		await writeFile(process.env.GIT_CONFIG_GLOBAL ?? '', '[gpg]\n\tformat =\n');
		const listCommits = await getCommits(
			executor,
			repo.cwd,
			10,
			{ ...filters, showSignatures: true },
			true
		);
		expect(listCommits.map((commit) => commit.subject)).toEqual(['signed', 'unsigned']);
		expect(listCommits.some((commit) => commit.signature)).toBe(false);
		const details = await getCommitDetails(executor, repo.cwd, listCommits[0].hash);
		expect(details.body).toBe('signed');
		expect(details.signature).toBeUndefined();
		await writeFile(process.env.GIT_CONFIG_GLOBAL ?? '', '');
	});

	it('unsets with null, and setting the same thing twice is fine', async () => {
		await setSigningConfig(executor, repo.cwd, { 'commit.gpgsign': null, 'tag.gpgsign': null });
		await setSigningConfig(executor, repo.cwd, { 'commit.gpgsign': null });
		const config = await getSigningConfig(executor, repo.cwd);
		expect(config.mapValues['commit.gpgsign']).toBeUndefined();
		expect(config.gitVersion).toBe(version);
	});
});
