import type {
	SigningConfigValue,
	SigningKey,
	SigningMessage,
	WritableSigningKey,
} from '@git-octopus/shared';
import { LIST_SIGNING_KEYS, LIST_WRITABLE_SIGNING_KEYS } from '@git-octopus/shared';
import type { GitExecutor } from './GitExecutor.js';

const SIGNING_KEYS_PATTERN = `^(${LIST_SIGNING_KEYS.map((key) => key.replaceAll('.', '\\.')).join('|')})$`;

/**
 * Parse `git config --show-scope --show-origin --get-regexp` output: `scope<TAB>origin<TAB>key value`,
 * one line per entry, lowest precedence first — so the last line for a key is the one git uses.
 */
export function parseSigningConfig(
	output: string
): Pick<SigningMessage, 'mapValues' | 'listLocalKeys'> {
	const mapValues: Partial<Record<SigningKey, SigningConfigValue>> = {};
	const setLocal = new Set<SigningKey>();
	for (const line of output.split('\n')) {
		const [scope, rawOrigin, entry] = line.split('\t');
		if (!scope || rawOrigin === undefined || entry === undefined) continue;
		const space = entry.indexOf(' ');
		const key = (space === -1 ? entry : entry.slice(0, space)) as SigningKey;
		if (!LIST_SIGNING_KEYS.includes(key)) continue;
		const origin = rawOrigin.replace(/^"|"$/g, '').replace(/^file:/, '');
		// A key with no `=` is git's shorthand for true, and prints with no space after it.
		mapValues[key] =
			space === -1
				? { value: '', bare: true, scope, origin }
				: { value: entry.slice(space + 1), scope, origin };
		if (scope === 'local' || scope === 'worktree') setLocal.add(key);
	}
	return { mapValues, listLocalKeys: [...setLocal] };
}

/** "git version 2.54.0 (Apple Git-157)" → "2.54.0". */
export function parseGitVersion(output: string): string | null {
	return /(\d+\.\d+(?:\.\d+)?)/.exec(output)?.[1] ?? null;
}

/** Read the signing config as the Signing tab shows it. */
export async function getSigningConfig(
	executor: GitExecutor,
	cwd: string
): Promise<Omit<SigningMessage, 'type' | 'repoPath'>> {
	const [config, version] = await Promise.all([
		executor
			.run(
				['config', '--show-scope', '--show-origin', '--get-regexp', SIGNING_KEYS_PATTERN],
				cwd,
				// 1 is "no key matched" — an unconfigured machine, not a failure.
				[0, 1]
			)
			.catch(() => ''),
		executor.run(['--version'], cwd).catch(() => ''),
	]);
	return { ...parseSigningConfig(config), gitVersion: parseGitVersion(version) };
}

const LIST_FORMATS = ['openpgp', 'ssh', 'x509'];
const LIST_BOOLEAN_KEYS: WritableSigningKey[] = ['commit.gpgsign', 'tag.gpgsign'];

/**
 * Why a value cannot be written, or null when it can. Every key reaches `git config` as its own
 * argument, never through a shell; what is refused is what git would misread — a leading dash
 * parsed as an option, a newline that breaks the file.
 */
export function signingValueProblem(key: string, value: string | null): string | null {
	if (!(LIST_WRITABLE_SIGNING_KEYS as readonly string[]).includes(key)) {
		return `${key} is not a signing setting.`;
	}
	if (value === null) return null;
	if (LIST_BOOLEAN_KEYS.includes(key as WritableSigningKey)) {
		return value === 'true' || value === 'false' ? null : `${key} must be true or false.`;
	}
	if (key === 'gpg.format') {
		return LIST_FORMATS.includes(value) ? null : `gpg.format must be ${LIST_FORMATS.join(', ')}.`;
	}
	if (value.trim() === '') return `${key} cannot be empty — clear it instead.`;
	if (value.startsWith('-')) return `${key} cannot start with “-”.`;
	if (/[\r\n\0]/.test(value)) return `${key} must be a single line.`;
	return null;
}

/**
 * Write the given keys to the repository's own config — never the global one, which other
 * repositories read too. A null removes the repository's value and lets the inherited one through.
 */
export async function setSigningConfig(
	executor: GitExecutor,
	cwd: string,
	mapValues: Partial<Record<WritableSigningKey, string | null>>
): Promise<void> {
	const listEntries = Object.entries(mapValues) as [WritableSigningKey, string | null][];
	for (const [key, value] of listEntries) {
		const problem = signingValueProblem(key, value);
		if (problem) throw new Error(problem);
	}
	for (const [key, value] of listEntries) {
		if (value === null) {
			// 5 is "nothing to unset" — already the state asked for.
			await executor.run(['config', '--local', '--unset-all', key], cwd, [0, 5]);
		} else {
			await executor.run(['config', '--local', key, value], cwd);
		}
	}
}
