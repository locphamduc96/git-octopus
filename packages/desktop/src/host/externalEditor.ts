import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

export type EditorId = 'vscode' | 'cursor' | 'zed' | 'sublime';

/** What the `externalEditor` setting holds: 'auto' picks the first editor found, a command is typed by the user. */
export type ExternalEditorSetting = 'auto' | EditorId | { command: string };

export interface EditorEntry {
	id: EditorId;
	name: string;
	bundleId: string;
}

/** Order here is the order 'auto' tries them in. */
export const listEditors: readonly EditorEntry[] = [
	{ id: 'vscode', name: 'Visual Studio Code', bundleId: 'com.microsoft.VSCode' },
	{ id: 'cursor', name: 'Cursor', bundleId: 'com.todesktop.230313mzl4w4u92' },
	{ id: 'zed', name: 'Zed', bundleId: 'dev.zed.Zed' },
	{ id: 'sublime', name: 'Sublime Text', bundleId: 'com.sublimetext.4' },
];

const mapEditors: Readonly<Record<EditorId, EditorEntry>> = Object.fromEntries(
	listEditors.map((entry) => [entry.id, entry])
) as Record<EditorId, EditorEntry>;

export const FILE_PLACEHOLDER = '{file}';

/** How the module reaches the system; tests answer these without touching macOS. Nothing here goes through a shell. */
export interface EditorRunner {
	/** Run a program to completion and answer its stdout. */
	capture(command: string, listArgs: string[]): Promise<string>;
	/**
	 * Start a program and let it run on its own; settles once it has started or failed to start.
	 * With `waitForExit` it settles when the program ends, and a nonzero exit rejects.
	 */
	launch(command: string, listArgs: string[], options?: LaunchOptions): Promise<void>;
}

export interface LaunchOptions {
	waitForExit?: boolean;
}

export interface LaunchPlan {
	command: string;
	listArgs: string[];
	via: EditorId | 'custom' | 'default';
}

export function systemEditorRunner(): EditorRunner {
	return {
		capture: (command, listArgs) =>
			new Promise((resolve, reject) => {
				execFile(command, listArgs, { encoding: 'utf8' }, (error, stdout) =>
					error ? reject(error) : resolve(stdout)
				);
			}),
		launch: (command, listArgs, options = {}) =>
			new Promise((resolve, reject) => {
				const child = spawn(command, listArgs, { shell: false, detached: true, stdio: 'ignore' });
				child.once('error', reject);
				if (options.waitForExit) {
					child.once('exit', (code, signal) =>
						code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? signal}`))
					);
					return;
				}
				child.once('spawn', () => {
					child.unref();
					resolve();
				});
			}),
	};
}

export function parseExternalEditorSetting(raw: unknown): ExternalEditorSetting {
	if (typeof raw === 'string' && (raw === 'auto' || Object.hasOwn(mapEditors, raw))) {
		return raw as ExternalEditorSetting;
	}
	if (typeof raw === 'object' && raw !== null && 'command' in raw) {
		const { command } = raw as { command: unknown };
		if (typeof command === 'string' && command.trim() !== '') return { command };
	}
	return 'auto';
}

/**
 * Splits a command line into words the way a shell would for quotes and backslashes, and nothing
 * else: `;`, `$()`, `|` and friends stay ordinary characters. Null for an unterminated quote.
 */
export function splitCommand(text: string): string[] | null {
	const listWords: string[] = [];
	let word = '';
	let inWord = false;
	let quote: '"' | "'" | null = null;
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (quote === "'") {
			if (char === "'") quote = null;
			else word += char;
		} else if (quote === '"') {
			if (char === '"') quote = null;
			else if (char === '\\' && (text[index + 1] === '"' || text[index + 1] === '\\'))
				word += text[++index];
			else word += char;
		} else if (char === '"' || char === "'") {
			quote = char;
			inWord = true;
		} else if (char === '\\' && index + 1 < text.length) {
			word += text[++index];
			inWord = true;
		} else if (/\s/.test(char)) {
			if (inWord || word !== '') listWords.push(word);
			word = '';
			inWord = false;
		} else {
			word += char;
			inWord = true;
		}
	}
	if (quote !== null) return null;
	if (inWord || word !== '') listWords.push(word);
	return listWords;
}

/**
 * The argv for a user-typed command. `{file}` inside any word becomes the path; with no
 * placeholder the path is the last argument. An unquoted absolute program path with spaces
 * ("/Applications/My Editor.app/Contents/MacOS/editor --wait {file}") is read back by joining
 * leading words until the result names a file that exists.
 */
export function buildCustomPlan(
	command: string,
	file: string,
	exists: (candidate: string) => boolean = existsSync
): LaunchPlan | null {
	const listWords = splitCommand(command);
	if (!listWords || listWords.length === 0 || listWords[0] === '') return null;
	let program = listWords[0];
	let used = 1;
	if (program.startsWith('/') && !exists(program)) {
		let joined = program;
		for (let count = 2; count <= listWords.length; count++) {
			joined = `${joined} ${listWords[count - 1]}`;
			if (exists(joined)) {
				program = joined;
				used = count;
				break;
			}
		}
	}
	const listRest = listWords.slice(used);
	const hasPlaceholder = listRest.some((word) => word.includes(FILE_PLACEHOLDER));
	const listArgs = hasPlaceholder
		? listRest.map((word) => word.split(FILE_PLACEHOLDER).join(file))
		: [...listRest, file];
	return { command: program, listArgs, via: 'custom' };
}

export function buildEditorPlan(editor: EditorId, file: string): LaunchPlan {
	return { command: 'open', listArgs: ['-b', mapEditors[editor].bundleId, file], via: editor };
}

export function buildDefaultPlan(file: string): LaunchPlan {
	return { command: 'open', listArgs: [file], via: 'default' };
}

export interface ExternalEditorOptions {
	exists?: (candidate: string) => boolean;
}

export class ExternalEditor {
	private readonly exists: (candidate: string) => boolean;
	private listInstalled: Promise<EditorId[]> | undefined;

	public constructor(
		private readonly runner: EditorRunner = systemEditorRunner(),
		options: ExternalEditorOptions = {}
	) {
		this.exists = options.exists ?? existsSync;
	}

	/** Editors Spotlight knows by bundle id, in the order of `listEditors`. Cached until `refresh()`. */
	public detectInstalled(): Promise<EditorId[]> {
		this.listInstalled ??= Promise.all(
			listEditors.map(async (entry) => {
				try {
					const out = await this.runner.capture('mdfind', [
						`kMDItemCFBundleIdentifier == '${entry.bundleId}'`,
					]);
					return out.trim() === '' ? null : entry.id;
				} catch {
					return null;
				}
			})
		).then((listFound) => listFound.filter((id): id is EditorId => id !== null));
		return this.listInstalled;
	}

	public refresh(): void {
		this.listInstalled = undefined;
	}

	public async plan(setting: ExternalEditorSetting, file: string): Promise<LaunchPlan> {
		const absolute = path.resolve(file);
		if (typeof setting === 'object') {
			return buildCustomPlan(setting.command, absolute, this.exists) ?? buildDefaultPlan(absolute);
		}
		const listInstalled = await this.detectInstalled();
		if (setting === 'auto') {
			return listInstalled.length > 0
				? buildEditorPlan(listInstalled[0], absolute)
				: buildDefaultPlan(absolute);
		}
		return listInstalled.includes(setting)
			? buildEditorPlan(setting, absolute)
			: buildDefaultPlan(absolute);
	}

	/** Opens the file in the chosen editor; if that cannot start, as macOS would open it. Answers which route ran. */
	public async openFile(setting: ExternalEditorSetting, file: string): Promise<LaunchPlan['via']> {
		const chosen = await this.plan(setting, file);
		try {
			await this.runner.launch(chosen.command, chosen.listArgs, {
				waitForExit: chosen.via !== 'custom',
			});
			return chosen.via;
		} catch (error) {
			if (chosen.via === 'default') throw error;
			const fallback = buildDefaultPlan(path.resolve(file));
			await this.runner.launch(fallback.command, fallback.listArgs, { waitForExit: true });
			return fallback.via;
		}
	}

	/** A conflicted file opens in the same editor as any other: there is no `git mergetool` on desktop. */
	public openConflictedFile(
		setting: ExternalEditorSetting,
		file: string
	): Promise<LaunchPlan['via']> {
		return this.openFile(setting, file);
	}
}
