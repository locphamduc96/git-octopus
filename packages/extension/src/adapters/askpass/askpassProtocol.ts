/**
 * Pure pieces of the askpass bridge: prompt classification, sanitising, and the one-line JSON
 * frame both ends of the socket speak. No vscode, no net — everything here is unit-testable.
 */

/** What kind of answer the prompt is asking for, and so what kind of UI it deserves. */
export type PromptKind = 'username' | 'secret' | 'confirm';

export interface ClassifiedPrompt {
	kind: PromptKind;
	/** The prompt as safe display text: control characters stripped, length capped. */
	display: string;
}

/** Longest prompt worth showing — anything past this is noise or an attack, not a question. */
const MAX_PROMPT_CHARS = 200;

/**
 * The prompt text comes from git, ssh, or whatever a remote sends through them — untrusted.
 * Control characters could fake UI lines or hide content, so they are stripped, and the length
 * capped, before any of it reaches a title or a label.
 */
export function sanitizePrompt(raw: string): string {
	const clean = raw
		// eslint-disable-next-line no-control-regex -- stripping them is the point
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return clean.length > MAX_PROMPT_CHARS ? `${clean.slice(0, MAX_PROMPT_CHARS)}…` : clean;
}

/**
 * Classify a prompt. The default is deliberately `secret`: only a username question that parses
 * exactly is shown unmasked — a localized password prompt, a keyboard-interactive question, or
 * anything unrecognised must land in a masked field, never in clear text.
 */
export function classifyPrompt(raw: string): ClassifiedPrompt {
	const display = sanitizePrompt(raw);
	if (/continue connecting|\(yes\/no/i.test(display)) return { kind: 'confirm', display };
	if (/^Username\b/i.test(display)) return { kind: 'username', display };
	return { kind: 'secret', display };
}

/** The two answers a confirmation may carry. Anything else is not a decision. */
export const CONFIRM_YES = 'yes';
export const CONFIRM_NO = 'no';

/**
 * The host's answer to one prompt.
 *
 * `ok` is the decision, and the client turns it straight into its exit status; `response` is the
 * text to print. They are separate because the two things a caller may read — the exit status and
 * stdout — are not always the same caller's business.
 */
export interface AskpassReply {
	ok: boolean;
	response?: string;
}

/**
 * Build the reply for an answered prompt.
 *
 * A refused confirmation must exit non-zero. OpenSSH decides a confirmation — an agent key added
 * with `ssh-add -c`, for one — by the askpass process's *exit status*, and reads a zero exit as
 * consent no matter what was printed; answering "no" on stdout while exiting 0 lets the operation
 * through. The refusal therefore travels as `ok: false`, and still carries the word for the
 * callers that compare the text instead (host-key questions do).
 */
export function buildReply(kind: PromptKind, response: string | undefined): AskpassReply {
	if (response === undefined) return { ok: false };
	if (kind === 'confirm') return { ok: response === CONFIRM_YES, response };
	return { ok: true, response };
}

/** Whole frames are one JSON object per line; anything bigger than this is refused. */
export const MAX_FRAME_BYTES = 8192;

export function encodeFrame(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

/**
 * Parse one frame. Returns null for malformed JSON or a frame that is not a plain object —
 * the caller drops the connection rather than guessing.
 */
export function decodeFrame(line: string): Record<string, unknown> | null {
	try {
		const value: unknown = JSON.parse(line);
		if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
		return value as Record<string, unknown>;
	} catch {
		return null;
	}
}
