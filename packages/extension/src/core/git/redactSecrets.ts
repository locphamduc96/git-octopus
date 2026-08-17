/**
 * Strip anything credential-shaped out of text that is about to be traced, shown, or thrown.
 *
 * Git puts the remote URL — including `user:token@` userinfo — into its error messages, and a
 * failed askpass exchange can surface paths and responses. Every trace line, notification and
 * error message passes through here first; the extra values let a caller scrub exact strings it
 * knows are sensitive (an askpass response, a socket path) wherever they might appear.
 */
export function redactSecrets(text: string, listExtra: string[] = []): string {
	let clean = text
		// http(s) URL userinfo: `https://user:token@host` and `https://token@host`.
		.replace(/(https?:\/\/)[^/\s@]+@/gi, '$1***@')
		// Authorization-style values, wherever a header or env dump leaks into a message.
		.replace(/(authorization[:=]\s*)(\S+(\s+\S+)?)/gi, '$1***');
	for (const extra of listExtra) {
		if (extra.length === 0) continue;
		clean = clean.split(extra).join('***');
	}
	return clean;
}
