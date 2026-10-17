import { describe, expect, it } from 'vitest';
import { launchedFromShell, mergePaths, parseShellPath } from './loginShell.js';

describe('loginShell', () => {
	it('reads the PATH out of whatever the startup files printed around it', () => {
		const stdout =
			'Welcome back!\n__GIT_OCTOPUS_PATH__/opt/homebrew/bin:/usr/bin__GIT_OCTOPUS_PATH__\n';
		expect(parseShellPath(stdout)).toBe('/opt/homebrew/bin:/usr/bin');
		expect(parseShellPath('no markers here')).toBeNull();
		expect(parseShellPath('__GIT_OCTOPUS_PATH____GIT_OCTOPUS_PATH__')).toBeNull();
	});

	it("puts the shell's entries first and keeps the app's own, once each", () => {
		expect(mergePaths('/opt/homebrew/bin:/usr/bin', '/usr/bin:/bin')).toBe(
			'/opt/homebrew/bin:/usr/bin:/bin'
		);
	});

	it('leaves an app started from a terminal alone', () => {
		expect(launchedFromShell({ SHLVL: '1' })).toBe(true);
		expect(launchedFromShell({ TERM_PROGRAM: 'iTerm.app' })).toBe(true);
		expect(launchedFromShell({ PATH: '/usr/bin:/bin' })).toBe(false);
	});
});
