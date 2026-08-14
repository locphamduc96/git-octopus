export interface ParsedSubject {
	/** A leading issue reference such as `ZG-2192`, without its brackets. */
	ticket: string | null;
	/** A conventional-commit type such as `feat`, when the subject uses one. */
	type: string | null;
	/** The optional scope in `feat(leaderboard):`. */
	scope: string | null;
	/** What remains once the reference and type are taken off. */
	text: string;
}

/**
 * Types offered in the commit dialog and recognised in the graph. Restricting to a known list
 * keeps ordinary subjects like `Update config: new values` from being read as a type.
 */
export const COMMIT_TYPES = [
	'feat',
	'fix',
	'chore',
	'refactor',
	'docs',
	'test',
	'style',
	'perf',
	'build',
	'ci',
	'revert',
] as const;

const setTypes = new Set<string>(COMMIT_TYPES);

/** Matches a leading `[TICKET]`, e.g. `[ZG-2192] Update config` or `[ABC-1, DEF-2] Fix`. */
const LEADING_BRACKET = /^\s*\[([^\]]+)\]\s*/;
/** Matches `feat: ` or `feat(scope): `. */
const TYPE_PREFIX = /^([a-z]+)(?:\(([^)]+)\))?:\s*/;

/**
 * Split a commit subject into its issue reference, conventional-commit type and message, so the
 * view can show the first two as chips. Anything that does not follow the shape is left whole.
 */
export function parseSubject(subject: string): ParsedSubject {
	let rest = subject;
	let ticket: string | null = null;
	let type: string | null = null;
	let scope: string | null = null;

	// A subject that is still only `[TICKET]` counts: the dialog parses half-typed subjects too,
	// and needs the reference recognised so a type lands after it rather than in front.
	const bracket = rest.match(LEADING_BRACKET);
	if (bracket && bracket[1].trim() !== '') {
		ticket = bracket[1].trim();
		rest = rest.slice(bracket[0].length);
	}

	const typed = rest.match(TYPE_PREFIX);
	if (typed && setTypes.has(typed[1])) {
		type = typed[1];
		scope = typed[2] ?? null;
		rest = rest.slice(typed[0].length);
	}

	return { ticket, type, scope, text: rest };
}

/** Rebuild a subject from its parts — the inverse of {@link parseSubject}. */
export function formatSubject(parts: ParsedSubject): string {
	const listPrefixes: string[] = [];
	if (parts.ticket) listPrefixes.push(`[${parts.ticket}]`);
	if (parts.type) listPrefixes.push(`${parts.type}${parts.scope ? `(${parts.scope})` : ''}:`);
	if (listPrefixes.length === 0) return parts.text;
	return `${listPrefixes.join(' ')} ${parts.text}`.trimEnd();
}

/**
 * Colour per commit type, so the kind of change is readable at a glance. Drawn as outlined chips,
 * which keeps every hue legible on both light and dark themes.
 */
const mapTypeColour: Record<string, string> = {
	feat: '#3fb950',
	fix: '#f85149',
	chore: '#8b949e',
	refactor: '#a371f7',
	docs: '#58a6ff',
	test: '#d29922',
	style: '#db61a2',
	perf: '#f0883e',
	build: '#6e7681',
	ci: '#6e7681',
	revert: '#f85149',
};

export function typeColour(type: string): string {
	return mapTypeColour[type] ?? '#8b949e';
}
