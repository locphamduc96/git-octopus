import { describe, expect, it } from 'vitest';
import { askpassHelperPaths, buildAskpassEnv } from './askpassEnv.js';

const PARTS = {
	scriptPath: '/opt/app/askpass/askpass.sh',
	mainPath: '/opt/app/askpass/askpass-main.cjs',
	nodePath: '/opt/app/bin/node',
	handle: '/tmp/gg-ask-x/s',
	nonce: 'n0nce',
};

describe('askpassHelperPaths', () => {
	it('names both files inside the directory it is given', () => {
		expect(askpassHelperPaths('/opt/with space/askpass')).toEqual({
			scriptPath: '/opt/with space/askpass/askpass.sh',
			mainPath: '/opt/with space/askpass/askpass-main.cjs',
		});
	});
});

describe('buildAskpassEnv', () => {
	it('points git and ssh at the script and hands the client its handle and nonce', () => {
		expect(buildAskpassEnv({ ...PARTS, display: ':1' })).toEqual({
			GIT_ASKPASS: PARTS.scriptPath,
			SSH_ASKPASS: PARTS.scriptPath,
			SSH_ASKPASS_REQUIRE: 'force',
			GIT_OCTOPUS_ASKPASS_NODE: PARTS.nodePath,
			GIT_OCTOPUS_ASKPASS_MAIN: PARTS.mainPath,
			GIT_OCTOPUS_ASKPASS_HANDLE: PARTS.handle,
			GIT_OCTOPUS_ASKPASS_NONCE: PARTS.nonce,
		});
	});

	it('supplies a DISPLAY only when the caller has none', () => {
		expect(buildAskpassEnv({ ...PARTS }).DISPLAY).toBe(':0');
		expect(buildAskpassEnv({ ...PARTS, display: '' }).DISPLAY).toBe(':0');
		expect(buildAskpassEnv({ ...PARTS, display: ':1' }).DISPLAY).toBeUndefined();
	});
});
