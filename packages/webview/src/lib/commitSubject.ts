export interface ParsedSubject {
	/** A leading issue reference such as `ZG-2192`, without its brackets. */
	ticket: string | null;
	/** The subject with the reference removed. */
	text: string;
}

/** Matches a leading `[TICKET]`, e.g. `[ZG-2192] Update config` or `[ABC-1, DEF-2] Fix`. */
const LEADING_BRACKET = /^\s*\[([^\]]+)\]\s*/;

/**
 * Split a leading bracketed issue reference off a commit subject so the view can show it as a
 * badge. Subjects without one are returned untouched.
 */
export function parseSubject(subject: string): ParsedSubject {
	const match = subject.match(LEADING_BRACKET);
	if (!match) return { ticket: null, text: subject };

	const ticket = match[1].trim();
	const text = subject.slice(match[0].length);
	// An empty label, or a subject that is nothing but the label, reads better left alone.
	if (ticket === '' || text === '') return { ticket: null, text: subject };
	return { ticket, text };
}
