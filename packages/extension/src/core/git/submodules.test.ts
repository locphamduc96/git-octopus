import { describe, expect, it } from 'vitest';
import { parseNameStatus, parseSubmoduleStatus } from './gitService';
import { parseSubmodulePaths, submoduleDiff } from './submodules';

const SHA = 'a'.repeat(40);

describe('parseSubmoduleStatus', () => {
	it('parses initialised, uninitialised and out-of-date entries alike', () => {
		const output = [
			` ${SHA} libs/engine (v1.2.0)`,
			`+${'b'.repeat(40)} libs/tools (heads/main)`,
			`-${'c'.repeat(40)} vendor/sdk`,
			`U${'d'.repeat(40)} conflicted/path (x)`,
		].join('\n');
		expect(parseSubmoduleStatus(output)).toEqual([
			{ hash: 'a'.repeat(8), path: 'libs/engine', initialized: true },
			{ hash: 'b'.repeat(8), path: 'libs/tools', initialized: true },
			{ hash: 'c'.repeat(8), path: 'vendor/sdk', initialized: false },
			{ hash: 'd'.repeat(8), path: 'conflicted/path', initialized: true },
		]);
	});

	it('returns nothing for a repository without submodules', () => {
		expect(parseSubmoduleStatus('')).toEqual([]);
	});
});

describe('parseNameStatus', () => {
	it('reads --raw lines as name-status ones, marking the submodules', () => {
		const zero = '0'.repeat(40);
		const output = [
			`:000000 160000 ${zero} ${'b'.repeat(40)} A\tlibs/engine`,
			`:100644 100644 ${'c'.repeat(40)} ${'d'.repeat(40)} M\tsrc/a b.ts`,
			`:100644 100644 ${'e'.repeat(40)} ${'f'.repeat(40)} R087\told.ts\tnew.ts`,
			'',
		].join('\n');
		expect(parseNameStatus(output)).toEqual([
			{ status: 'A', path: 'libs/engine', submodule: {} },
			{ status: 'M', path: 'src/a b.ts' },
			{ status: 'R', oldPath: 'old.ts', path: 'new.ts' },
		]);
	});

	it('still reads plain name-status lines', () => {
		expect(parseNameStatus('M\ta.ts\nD\tb.ts')).toEqual([
			{ status: 'M', path: 'a.ts' },
			{ status: 'D', path: 'b.ts' },
		]);
	});
});

describe('parseSubmodulePaths', () => {
	it('takes the path of every submodule, once', () => {
		const output = [
			'submodule.engine.path\nlibs/engine',
			'submodule.my sdk.path\nvendor/my sdk',
			'submodule.engine.url\n../engine.git',
			'',
		].join('\0');
		expect(parseSubmodulePaths(output)).toEqual(['libs/engine', 'vendor/my sdk']);
	});
});

describe('submoduleDiff', () => {
	const a = 'a'.repeat(40);
	const b = 'b'.repeat(40);

	it('reads a pointer move, an addition and a removal', () => {
		expect(submoduleDiff(`Subproject commit ${a}`, `Subproject commit ${b}`, '/r/sub')).toEqual({
			from: a,
			to: b,
			dirty: false,
			repoPath: '/r/sub',
		});
		expect(submoduleDiff('', `Subproject commit ${b}`, null)).toEqual({
			to: b,
			dirty: false,
			repoPath: null,
		});
		expect(submoduleDiff(`Subproject commit ${a}`, '', null)).toMatchObject({ from: a });
	});

	it('sees a checkout with edits of its own', () => {
		expect(
			submoduleDiff(`Subproject commit ${a}`, `Subproject commit ${a}-dirty`, null)
		).toMatchObject({ from: a, to: a, dirty: true });
	});

	it('leaves real text alone — even text that mentions a subproject', () => {
		expect(submoduleDiff('const x = 1;', 'const x = 2;', null)).toBeNull();
		expect(submoduleDiff('', 'Subproject commit is a phrase in this README', null)).toBeNull();
		expect(submoduleDiff(`Subproject commit ${a}\nmore`, '', null)).toBeNull();
	});
});
