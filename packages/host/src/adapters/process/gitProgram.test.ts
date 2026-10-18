import { afterEach, describe, expect, it } from 'vitest';
import { gitProgramFor, resolveGitProgram, setGitPathSource } from './gitProgram.js';

describe('gitProgramFor', () => {
	it('runs plain git, found on the PATH, when the setting is empty or missing', () => {
		expect(gitProgramFor(undefined)).toBe('git');
		expect(gitProgramFor('')).toBe('git');
		expect(gitProgramFor('   ')).toBe('git');
	});

	it('runs the path that was set, trimmed', () => {
		expect(gitProgramFor('  /opt/homebrew/bin/git ')).toBe('/opt/homebrew/bin/git');
	});

	it('reads a leading ~/ as the home folder', () => {
		expect(gitProgramFor('~/bin/git', '/Users/octo')).toBe('/Users/octo/bin/git');
		expect(gitProgramFor('~', '/Users/octo')).toBe('/Users/octo');
		expect(gitProgramFor('/a/~/git', '/Users/octo')).toBe('/a/~/git');
	});
});

describe('resolveGitProgram', () => {
	afterEach(() => setGitPathSource(() => undefined));

	it('runs git on the PATH until a source is set', () => {
		expect(resolveGitProgram()).toBe('git');
	});

	it('follows the source it was given on every call', () => {
		let chosen: string | undefined = '/one/git';
		setGitPathSource(() => chosen);
		expect(resolveGitProgram()).toBe('/one/git');
		chosen = undefined;
		expect(resolveGitProgram()).toBe('git');
	});
});
