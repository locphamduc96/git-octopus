import type { ChangeTier } from './classifyChanges.js';

/**
 * Build the one-shot prompt handed to the agent CLI on stdin.
 *
 * The agent is a text generator, nothing more: it sees a file listing, the diffs worth reading,
 * and the repository's recent subject style, and must answer with one JSON object. It is never
 * given tools and never told to run anything.
 */

export interface PromptFile {
	path: string;
	status: string;
	tier: ChangeTier;
	additions?: number;
	deletions?: number;
	/** Unified diff, only ever set for `source`-tier files. */
	diff?: string;
}

export interface PromptInput {
	branch: string | null;
	listRecentSubjects: string[];
	listFiles: PromptFile[];
	/** Language for subjects and bodies; empty or absent = follow the recent subjects. */
	language?: string;
}

/** A single file's diff is cut after this many lines — past that it reads as noise. */
export const MAX_DIFF_LINES_PER_FILE = 400;
/** All diffs together stay under this, so an enormous working tree cannot flood the prompt. */
export const MAX_TOTAL_DIFF_CHARS = 80_000;

const STATUS_LABELS: Record<string, string> = {
	'?': 'new',
	A: 'added',
	M: 'modified',
	D: 'deleted',
	R: 'renamed',
	C: 'copied',
	U: 'conflicted',
};

function fileLine(file: PromptFile): string {
	const status = STATUS_LABELS[file.status] ?? 'modified';
	const counts =
		file.additions !== undefined || file.deletions !== undefined
			? ` (+${file.additions ?? 0}/-${file.deletions ?? 0})`
			: '';
	const note =
		file.tier === 'binary'
			? ' [binary]'
			: file.tier === 'asset'
				? ' [generated/large: content not shown]'
				: file.tier === 'excluded'
					? ' [excluded from AI input]'
					: '';
	return `- ${file.path} — ${status}${counts}${note}`;
}

function truncateDiff(diff: string): string {
	const listLines = diff.split('\n');
	if (listLines.length <= MAX_DIFF_LINES_PER_FILE) return diff;
	const kept = listLines.slice(0, MAX_DIFF_LINES_PER_FILE).join('\n');
	return `${kept}\n… (${listLines.length - MAX_DIFF_LINES_PER_FILE} more lines truncated)`;
}

/**
 * Pick which source diffs actually ride along: smallest first, until the budget runs out.
 * Small diffs carry the most meaning per character; one massive refactor dump would otherwise
 * push every other file's context out.
 */
function selectDiffs(listFiles: PromptFile[]): Map<string, string> {
	const listWithDiff = listFiles
		.filter((file) => file.tier === 'source' && file.diff)
		.map((file) => ({ path: file.path, diff: truncateDiff(file.diff as string) }))
		.sort((a, b) => a.diff.length - b.diff.length);
	const mapSelected = new Map<string, string>();
	let used = 0;
	for (const { path, diff } of listWithDiff) {
		if (used + diff.length > MAX_TOTAL_DIFF_CHARS) continue;
		used += diff.length;
		mapSelected.set(path, diff);
	}
	return mapSelected;
}

export function buildCommitPrompt(input: PromptInput): string {
	const mapDiffs = selectDiffs(input.listFiles);
	const listSections: string[] = [];

	listSections.push(
		'You are generating git commits for the changes below. Respond with ONE JSON object and nothing else — no prose, no markdown fences.',
		'',
		'Required JSON shape:',
		'{',
		'  "groups": [ { "files": ["path", …], "subject": "…", "body": "…" }, … ],',
		'  "single": { "subject": "…", "body": "…" }',
		'}',
		'',
		'Rules:',
		'- "groups": split the changes into the smallest set of coherent commits (1 or more). Every changed file must appear in exactly one group. Group by purpose, not by folder. Keep a generated file with the change that caused it (a lockfile with its dependency change, a *.meta with its asset).',
		'- "single": the message to use if everything is committed as one commit instead.',
		'- Subjects: imperative mood, at most 72 characters, no trailing period. Match the style of the recent subjects listed below when there are any.',
		'- Subjects start with a bare Conventional Commits type prefix: "feat: ", "fix: ", "chore: ", "refactor: ", "docs: ", "test: ", "perf: ", "build: ", "ci: " or "style: ". Never add a scope in parentheses — write "feat: …", not "feat(home): …" — even when the recent subjects use scopes. Put that extra context in the rest of the subject or in the body instead.',
		'- Body: optional; explain why, wrapped at 72 characters. Omit or use "" when the subject says it all.',
		'- Do not invent files. Use the paths exactly as listed.'
	);

	// Style matching is what otherwise decides the language, so this has to override it outright —
	// and the type prefix is a convention, not prose, so it stays English in every language.
	const language = input.language?.trim();
	if (language) {
		listSections.push(
			`- Write every subject and body in ${language}, whatever language the recent subjects below are written in. Keep the Conventional Commits type prefix in English.`
		);
	}

	if (input.branch) listSections.push('', `Branch: ${input.branch}`);

	if (input.listRecentSubjects.length > 0) {
		listSections.push('', 'Recent commit subjects (style reference):');
		for (const subject of input.listRecentSubjects) listSections.push(`- ${subject}`);
	}

	listSections.push('', `Changed files (${input.listFiles.length}):`);
	for (const file of input.listFiles) listSections.push(fileLine(file));

	if (mapDiffs.size > 0) {
		listSections.push('', 'Diffs (files without a diff here are summarized above):');
		for (const [path, diff] of mapDiffs) {
			listSections.push('', `--- ${path} ---`, diff);
		}
	}

	listSections.push('', 'Answer with the JSON object only.');
	return listSections.join('\n');
}
