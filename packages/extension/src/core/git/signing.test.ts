import { describe, expect, it } from 'vitest';
import type { GitExecutor } from './GitExecutor.js';
import {
	parseGitVersion,
	parseSigningConfig,
	setSigningConfig,
	signingValueProblem,
} from './signing.js';

describe('parseSigningConfig', () => {
	it('keeps the last value of each key, with where it came from', () => {
		const output = [
			'global\tfile:/Users/me/.gitconfig\tgpg.program gpg',
			'global\tfile:/Users/me/.gitconfig\tgpg.format ',
			'global\tfile:/Users/me/.gitconfig\tcommit.gpgsign',
			'local\tfile:.git/config\tgpg.format ssh',
			'local\tfile:.git/config\tuser.signingkey key::ssh-ed25519 AAAA x@y',
			'',
		].join('\n');
		const { mapValues, listLocalKeys } = parseSigningConfig(output);
		expect(mapValues['gpg.format']).toEqual({
			value: 'ssh',
			scope: 'local',
			origin: '.git/config',
		});
		expect(mapValues['commit.gpgsign']).toEqual({
			value: '',
			bare: true,
			scope: 'global',
			origin: '/Users/me/.gitconfig',
		});
		// A value with spaces in it survives whole.
		expect(mapValues['user.signingkey']?.value).toBe('key::ssh-ed25519 AAAA x@y');
		expect(listLocalKeys.sort()).toEqual(['gpg.format', 'user.signingkey']);
	});

	it('ignores keys it did not ask for and lines it cannot read', () => {
		const { mapValues } = parseSigningConfig('global\tfile:/x\tuser.name Ada\nnonsense');
		expect(mapValues).toEqual({});
	});
});

describe('parseGitVersion', () => {
	it('reads the number out of every vendor spelling', () => {
		expect(parseGitVersion('git version 2.54.0 (Apple Git-157)\n')).toBe('2.54.0');
		expect(parseGitVersion('git version 2.34.1.windows.1')).toBe('2.34.1');
		expect(parseGitVersion('')).toBeNull();
	});
});

describe('signingValueProblem', () => {
	it('accepts what git reads and refuses what it would misread', () => {
		expect(signingValueProblem('commit.gpgsign', 'true')).toBeNull();
		expect(signingValueProblem('commit.gpgsign', 'yes please')).not.toBeNull();
		expect(signingValueProblem('gpg.format', 'ssh')).toBeNull();
		expect(signingValueProblem('gpg.format', '')).not.toBeNull();
		expect(signingValueProblem('user.signingkey', '~/.ssh/id_ed25519.pub')).toBeNull();
		expect(signingValueProblem('user.signingkey', '--global')).not.toBeNull();
		expect(signingValueProblem('user.signingkey', 'a\nb')).not.toBeNull();
		expect(signingValueProblem('user.signingkey', null)).toBeNull();
	});

	it('refuses keys outside the Signing tab — the program paths included', () => {
		expect(signingValueProblem('gpg.ssh.program', '/bin/sh')).not.toBeNull();
		expect(signingValueProblem('core.hooksPath', '/tmp')).not.toBeNull();
	});
});

describe('setSigningConfig', () => {
	function recorder(): { executor: GitExecutor; listCalls: string[][] } {
		const listCalls: string[][] = [];
		return {
			listCalls,
			executor: {
				run: async (args: string[]) => {
					listCalls.push(args);
					return '';
				},
			} as unknown as GitExecutor,
		};
	}

	it('writes the repository config only, and unsets with null', async () => {
		const { executor, listCalls } = recorder();
		await setSigningConfig(executor, '/repo', {
			'commit.gpgsign': 'true',
			'user.signingkey': null,
		});
		expect(listCalls).toEqual([
			['config', '--local', 'commit.gpgsign', 'true'],
			['config', '--local', '--unset-all', 'user.signingkey'],
		]);
	});

	it('writes nothing when any value is refused', async () => {
		const { executor, listCalls } = recorder();
		await expect(
			setSigningConfig(executor, '/repo', { 'commit.gpgsign': 'true', 'gpg.format': 'pgp' })
		).rejects.toThrow(/gpg.format/);
		expect(listCalls).toEqual([]);
	});
});
