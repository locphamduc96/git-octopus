import { fileLine, selectDiffs, type PromptFile } from './commitPrompt.js';

/**
 * The one-shot prompt that asks an agent CLI to explain a change. Like the commit prompt, the
 * agent only reads: every file is named, and only source files carry their diff, within the same
 * budget.
 */

export interface ExplainCommit {
	hash: string;
	author: string;
	subject: string;
	body: string;
}

export interface ExplainPromptInput {
	/** What is being explained, in words: "commit 1a2b3c4d — fix: …", "branch feature/x …". */
	title: string;
	/** Oldest first; empty for uncommitted changes. */
	listCommits: ExplainCommit[];
	/** How many commits of the range were left out of `listCommits`. */
	moreCommits: number;
	listFiles: PromptFile[];
	/** Language for the explanation; empty or absent = English. */
	language?: string;
}

/** A commit body is context, not the subject of the explanation: past this it is cut. */
const MAX_BODY_LINES = 20;

export function buildExplainPrompt(input: ExplainPromptInput): string {
	const mapDiffs = selectDiffs(input.listFiles);
	const listSections: string[] = [
		'Explain the change below to a developer who is about to review it or build on it. Answer in Markdown, with no preamble and no closing remarks.',
		'',
		'Use these sections:',
		'## Summary — two to four sentences: what changes and, as far as the code and messages show, why.',
		'## Changes — bullets grouped by purpose, naming the files involved.',
		'## Things to check — only real ones: behaviour changes, edge cases, missing tests, migrations, risky spots. Leave the section out when there are none.',
		'',
		'Rules:',
		'- Do not invent intent the code and the messages do not show; say so when the reason is unclear.',
		'- Files listed without a diff were left out on purpose (binary, generated, too large or excluded) — mention them by name only.',
	];
	const language = input.language?.trim();
	if (language) listSections.push(`- Write the whole explanation in ${language}.`);

	listSections.push('', `Subject: ${input.title}`);

	if (input.listCommits.length > 0) {
		listSections.push('', 'Commits (oldest first):');
		for (const commit of input.listCommits) {
			listSections.push(`- ${commit.hash.slice(0, 8)} ${commit.subject} (${commit.author})`);
			const listBody = commit.body
				.trim()
				.split('\n')
				.filter((line) => line.trim() !== '');
			for (const line of listBody.slice(0, MAX_BODY_LINES)) listSections.push(`    ${line}`);
			if (listBody.length > MAX_BODY_LINES) listSections.push('    …');
		}
		if (input.moreCommits > 0) {
			listSections.push(`- … and ${input.moreCommits} older commits not listed`);
		}
	}

	listSections.push('', `Changed files (${input.listFiles.length}):`);
	for (const file of input.listFiles) listSections.push(fileLine(file));

	if (mapDiffs.size > 0) {
		listSections.push('', 'Diffs (files without a diff here are summarized above):');
		for (const [path, diff] of mapDiffs) listSections.push('', `--- ${path} ---`, diff);
	}
	return listSections.join('\n');
}
