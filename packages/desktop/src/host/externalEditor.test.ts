import { describe, expect, it } from 'vitest';
import {
	ExternalEditor,
	buildCustomPlan,
	parseExternalEditorSetting,
	splitCommand,
	systemEditorRunner,
	type EditorRunner,
} from './externalEditor.js';

interface Call {
	command: string;
	listArgs: string[];
}

function fakeRunner(listBundles: string[], failLaunch: (call: Call) => boolean = () => false) {
	const listCaptured: Call[] = [];
	const listLaunched: Call[] = [];
	const runner: EditorRunner = {
		capture: (command, listArgs) => {
			listCaptured.push({ command, listArgs });
			const hit = listBundles.some((id) => listArgs[0].includes(`'${id}'`));
			return Promise.resolve(hit ? '/Applications/Some.app\n' : '');
		},
		launch: (command, listArgs) => {
			const call = { command, listArgs };
			listLaunched.push(call);
			return failLaunch(call) ? Promise.reject(new Error('ENOENT')) : Promise.resolve();
		},
	};
	return { runner, listCaptured, listLaunched };
}

const ALL = [
	'com.microsoft.VSCode',
	'com.todesktop.230313mzl4w4u92',
	'dev.zed.Zed',
	'com.sublimetext.4',
];

describe('ExternalEditor', () => {
	it.each([
		['vscode', 'com.microsoft.VSCode'],
		['cursor', 'com.todesktop.230313mzl4w4u92'],
		['zed', 'dev.zed.Zed'],
		['sublime', 'com.sublimetext.4'],
	] as const)('opens a file in %s by bundle id', async (id, bundle) => {
		const { runner, listLaunched } = fakeRunner(ALL);
		const via = await new ExternalEditor(runner).openFile(id, '/repo/src/a b.ts');
		expect(via).toBe(id);
		expect(listLaunched).toEqual([
			{ command: 'open', listArgs: ['-b', bundle, '/repo/src/a b.ts'] },
		]);
	});

	it('asks Spotlight once per editor with the query as a single argument', async () => {
		const { runner, listCaptured } = fakeRunner(ALL);
		const editor = new ExternalEditor(runner);
		await editor.openFile('auto', '/repo/a.ts');
		await editor.openFile('auto', '/repo/b.ts');
		expect(listCaptured).toHaveLength(4);
		expect(listCaptured[0]).toEqual({
			command: 'mdfind',
			listArgs: ["kMDItemCFBundleIdentifier == 'com.microsoft.VSCode'"],
		});
	});

	it('auto picks the first editor found, in the fixed order', async () => {
		const { runner, listLaunched } = fakeRunner(['dev.zed.Zed', 'com.sublimetext.4']);
		await new ExternalEditor(runner).openFile('auto', '/repo/a.ts');
		expect(listLaunched[0].listArgs).toEqual(['-b', 'dev.zed.Zed', '/repo/a.ts']);
	});

	it('falls back to macOS open when nothing is installed', async () => {
		const { runner, listLaunched } = fakeRunner([]);
		const via = await new ExternalEditor(runner).openFile('auto', '/repo/a.ts');
		expect(via).toBe('default');
		expect(listLaunched).toEqual([{ command: 'open', listArgs: ['/repo/a.ts'] }]);
	});

	it('falls back to open when the chosen editor is missing', async () => {
		const { runner, listLaunched } = fakeRunner(['com.microsoft.VSCode']);
		const via = await new ExternalEditor(runner).openFile('zed', '/repo/a.ts');
		expect(via).toBe('default');
		expect(listLaunched).toEqual([{ command: 'open', listArgs: ['/repo/a.ts'] }]);
	});

	it('treats a failing Spotlight query as not installed', async () => {
		const runner: EditorRunner = {
			capture: () => Promise.reject(new Error('mdfind failed')),
			launch: () => Promise.resolve(),
		};
		expect(await new ExternalEditor(runner).detectInstalled()).toEqual([]);
	});

	it('opens a conflicted file in the same editor as any other file', async () => {
		const { runner, listLaunched } = fakeRunner(ALL);
		const editor = new ExternalEditor(runner);
		await editor.openFile('cursor', '/repo/x.ts');
		await editor.openConflictedFile('cursor', '/repo/x.ts');
		expect(listLaunched[1]).toEqual(listLaunched[0]);
		expect(listLaunched[1].listArgs[1]).toBe('com.todesktop.230313mzl4w4u92');
	});

	it('resolves a relative path so it can never read as an option', async () => {
		const { runner, listLaunched } = fakeRunner(ALL);
		await new ExternalEditor(runner).openFile('vscode', '-n');
		expect(listLaunched[0].listArgs[2].startsWith('/')).toBe(true);
	});

	it('runs a custom command as argv with {file} replaced, no shell', async () => {
		const { runner, listLaunched, listCaptured } = fakeRunner(ALL);
		const via = await new ExternalEditor(runner, { exists: () => true }).openFile(
			{ command: '/usr/local/bin/ed --goto={file} --wait' },
			'/repo/my file.ts',
		);
		expect(via).toBe('custom');
		expect(listCaptured).toHaveLength(0);
		expect(listLaunched).toEqual([
			{ command: '/usr/local/bin/ed', listArgs: ['--goto=/repo/my file.ts', '--wait'] },
		]);
	});

	it('falls back to open when a custom command cannot start', async () => {
		const { runner, listLaunched } = fakeRunner(ALL, (call) => call.command === '/nope/ed');
		const via = await new ExternalEditor(runner, { exists: () => true }).openFile(
			{ command: '/nope/ed {file}' },
			'/repo/a.ts',
		);
		expect(via).toBe('default');
		expect(listLaunched.map((call) => call.command)).toEqual(['/nope/ed', 'open']);
		expect(listLaunched[1].listArgs).toEqual(['/repo/a.ts']);
	});

	it('falls back to open when open -b starts but then exits nonzero', async () => {
		const { runner, listLaunched } = fakeRunner(ALL, (call) => call.listArgs[0] === '-b');
		const via = await new ExternalEditor(runner).openFile('vscode', '/repo/a.ts');
		expect(via).toBe('default');
		expect(listLaunched.map((call) => call.listArgs)).toEqual([
			['-b', 'com.microsoft.VSCode', '/repo/a.ts'],
			['/repo/a.ts'],
		]);
	});

	it('waits for open to exit but not for a custom command', async () => {
		const listWaits: Array<boolean | undefined> = [];
		const runner: EditorRunner = {
			capture: () => Promise.resolve('/Applications/Some.app\n'),
			launch: (_command, _listArgs, options) => {
				listWaits.push(options?.waitForExit);
				return Promise.resolve();
			},
		};
		const editor = new ExternalEditor(runner, { exists: () => true });
		await editor.openFile('vscode', '/repo/a.ts');
		await editor.openFile({ command: '/usr/local/bin/ed --wait {file}' }, '/repo/a.ts');
		expect(listWaits).toEqual([true, false]);
	});

	it('uses open for an empty or unterminated custom command', async () => {
		const { runner, listLaunched } = fakeRunner(ALL);
		const editor = new ExternalEditor(runner);
		await editor.openFile({ command: '   ' }, '/repo/a.ts');
		await editor.openFile({ command: 'ed "unterminated {file}' }, '/repo/a.ts');
		expect(listLaunched.map((call) => call.command)).toEqual(['open', 'open']);
	});
});

describe('splitCommand', () => {
	it('splits on whitespace and honours quotes and backslashes', () => {
		expect(splitCommand(`ed  --flag "a b" 'c d' e\\ f`)).toEqual(['ed', '--flag', 'a b', 'c d', 'e f']);
		expect(splitCommand(`ed "say \\"hi\\""`)).toEqual(['ed', 'say "hi"']);
		expect(splitCommand(`ed ""`)).toEqual(['ed', '']);
	});

	it('keeps shell syntax literal', () => {
		expect(splitCommand('ed a;rm -rf / $(whoami) `id` | cat > x && y')).toEqual([
			'ed',
			'a;rm',
			'-rf',
			'/',
			'$(whoami)',
			'`id`',
			'|',
			'cat',
			'>',
			'x',
			'&&',
			'y',
		]);
		expect(splitCommand(`ed '$(whoami); x'`)).toEqual(['ed', '$(whoami); x']);
	});

	it('refuses an unterminated quote', () => {
		expect(splitCommand(`ed "abc`)).toBeNull();
	});
});

describe('buildCustomPlan', () => {
	it('appends the file when there is no placeholder', () => {
		expect(buildCustomPlan('ed --wait', '/r/a.ts')).toEqual({
			command: 'ed',
			listArgs: ['--wait', '/r/a.ts'],
			via: 'custom',
		});
	});

	it('keeps odd characters in the path as one literal argument', () => {
		const file = '/r/a b";rm -rf ~;$(id)`x`\'.ts';
		const plan = buildCustomPlan('ed {file}', file);
		expect(plan?.listArgs).toEqual([file]);
		expect(buildCustomPlan('ed', file)?.listArgs).toEqual([file]);
	});

	it('keeps ; and $() typed in the command literal', () => {
		const plan = buildCustomPlan('ed "--title=a;b" $(touch /tmp/x) {file}', '/r/a.ts');
		expect(plan).toEqual({
			command: 'ed',
			listArgs: ['--title=a;b', '$(touch', '/tmp/x)', '/r/a.ts'],
			via: 'custom',
		});
	});

	it('reads an unquoted program path with spaces by finding the file that exists', () => {
		const program = '/Applications/My Editor.app/Contents/MacOS/editor';
		const plan = buildCustomPlan(`${program} --wait {file}`, '/r/a.ts', (candidate) => candidate === program);
		expect(plan).toEqual({ command: program, listArgs: ['--wait', '/r/a.ts'], via: 'custom' });
	});

	it('takes a quoted program path with spaces as it is', () => {
		const plan = buildCustomPlan('"/Applications/My Editor.app/Contents/MacOS/editor" {file}', '/r/a.ts', () => true);
		expect(plan?.command).toBe('/Applications/My Editor.app/Contents/MacOS/editor');
		expect(plan?.listArgs).toEqual(['/r/a.ts']);
	});

	it('replaces every placeholder in a word', () => {
		expect(buildCustomPlan('ed {file}:1 {file}', '/r/a.ts', () => true)?.listArgs).toEqual([
			'/r/a.ts:1',
			'/r/a.ts',
		]);
	});
});

describe('systemEditorRunner.launch', () => {
	it('rejects a nonzero exit only when asked to wait for it', async () => {
		const runner = systemEditorRunner();
		await expect(runner.launch('false', [], { waitForExit: true })).rejects.toThrow();
		await expect(runner.launch('true', [], { waitForExit: true })).resolves.toBeUndefined();
		await expect(runner.launch('false', [])).resolves.toBeUndefined();
	});

	it('rejects a program that cannot start', async () => {
		await expect(
			systemEditorRunner().launch('/nope/does-not-exist', [], { waitForExit: true }),
		).rejects.toThrow();
	});
});

describe('parseExternalEditorSetting', () => {
	it('accepts the known values and a command, and answers auto for anything else', () => {
		expect(parseExternalEditorSetting('zed')).toBe('zed');
		expect(parseExternalEditorSetting('auto')).toBe('auto');
		expect(parseExternalEditorSetting({ command: 'ed {file}' })).toEqual({ command: 'ed {file}' });
		expect(parseExternalEditorSetting({ command: ' ' })).toBe('auto');
		expect(parseExternalEditorSetting('toString')).toBe('auto');
		expect(parseExternalEditorSetting(undefined)).toBe('auto');
		expect(parseExternalEditorSetting(42)).toBe('auto');
	});
});
