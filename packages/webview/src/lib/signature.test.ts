import { describe, expect, it } from 'vitest';
import type { SigningMessage } from '@git-octopus/shared';
import { effectiveFormat, gitBool, signingProblems, versionBefore } from './signature';

const at = { scope: 'local', origin: '.git/config' };

function state(mapValues: SigningMessage['mapValues'], gitVersion = '2.54.0'): SigningMessage {
	return { type: 'signing', repoPath: '/r', mapValues, listLocalKeys: [], gitVersion };
}

describe('gitBool', () => {
	it('reads booleans the way git does', () => {
		expect(gitBool(undefined)).toBeNull();
		expect(gitBool({ value: '', bare: true, ...at })).toBe(true);
		expect(gitBool({ value: 'Yes', ...at })).toBe(true);
		expect(gitBool({ value: '', ...at })).toBe(false);
		expect(gitBool({ value: '2', ...at })).toBe(true);
		expect(gitBool({ value: 'maybe', ...at })).toBeNull();
	});
});

describe('effectiveFormat', () => {
	it('defaults to openpgp and refuses what git refuses', () => {
		expect(effectiveFormat(state({}))).toBe('openpgp');
		expect(effectiveFormat(state({ 'gpg.format': { value: 'ssh', ...at } }))).toBe('ssh');
		expect(effectiveFormat(state({ 'gpg.format': { value: '', ...at } }))).toBeNull();
	});
});

describe('versionBefore', () => {
	it('compares major then minor', () => {
		expect(versionBefore('2.33.9', 2, 34)).toBe(true);
		expect(versionBefore('2.34.0', 2, 34)).toBe(false);
		expect(versionBefore('3.0', 2, 34)).toBe(false);
		expect(versionBefore(null, 2, 34)).toBe(false);
	});
});

describe('signingProblems', () => {
	it('is quiet for a working setup', () => {
		expect(
			signingProblems(
				state({
					'gpg.format': { value: 'ssh', ...at },
					'commit.gpgsign': { value: 'true', ...at },
					'user.signingkey': { value: '~/.ssh/id.pub', ...at },
					'gpg.ssh.allowedsignersfile': { value: '~/.ssh/allowed', ...at },
				})
			)
		).toEqual([]);
		expect(signingProblems(state({}))).toEqual([]);
	});

	it('flags an empty program only for the format in use', () => {
		const empty = { value: '', ...at };
		expect(signingProblems(state({ 'gpg.ssh.program': empty }))).toEqual([]);
		expect(signingProblems(state({ 'gpg.program': empty }))[0]).toMatch(/gpg.program is empty/);
	});

	it('flags old git, a missing signers file and a missing key under SSH', () => {
		const listProblems = signingProblems(
			state(
				{ 'gpg.format': { value: 'ssh', ...at }, 'commit.gpgsign': { value: 'true', ...at } },
				'2.30.1'
			)
		);
		expect(listProblems).toHaveLength(3);
		expect(listProblems[0]).toMatch(/2.34/);
	});
});
