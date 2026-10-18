/**
 * Port: ask the user for a credential git (or ssh) is waiting on. Implemented with native
 * QuickPick / InputBox in the VS Code extension and with a dialog in the desktop renderer.
 *
 * It is separate from {@link UserPrompt} on purpose: a credential prompt belongs to a git process
 * that is already running, may be asked by something other than the user's own action, and its
 * text is written by whatever sits on the other end of the connection.
 */
export interface CredentialRequest {
	/** Set by the host from trusted context (operation, repository, remote hosts) — never by git. */
	title: string;
	/**
	 * The question git or ssh asked, control characters stripped and length capped. It is data:
	 * show it as text, never as markup, and never let it choose the title or the field type.
	 */
	prompt: string;
	/**
	 * Mask the answer. True for everything except a username question that was positively
	 * identified, so a localized password prompt or an unknown question never lands in clear text.
	 * A host-key confirmation also arrives with this set; a UI that wants buttons for it recognises
	 * the question with `classifyPrompt` and answers `CONFIRM_YES` / `CONFIRM_NO`.
	 */
	secret: boolean;
}

export interface CredentialPrompt {
	/**
	 * The answer, or undefined when the user cancelled — git then receives no answer and the
	 * command fails. `signal` aborts once the asking git process is gone (timed out, killed or
	 * finished); the UI must take itself down then, since nothing it collects can be delivered
	 * and the next command's prompt waits behind it.
	 */
	ask(request: CredentialRequest, signal: AbortSignal): Promise<string | undefined>;
}
