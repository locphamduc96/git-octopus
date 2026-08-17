/**
 * Port: ask the user something during an action. Implemented twice — with the product's own
 * dialogs inside the webview that started the action, and with native VS Code UI for actions
 * that have no webview (sidebar tree, command palette) or whose webview vanished mid-flow.
 *
 * Payloads are declarative data, never callbacks: a request may cross the extension↔webview
 * boundary, so validation is expressed as rules (`required`) both sides can apply.
 *
 * Credentials never come through this port — askpass has its own, permanently native, path.
 */
export interface ConfirmRequest {
	title: string;
	message: string;
	/** Label of the accepting button; "Yes" when omitted. */
	confirmLabel?: string;
	/** Styles the accepting button as destructive. */
	danger?: boolean;
}

export interface PickOption {
	id: string;
	label: string;
	description?: string;
	picked?: boolean;
}

export interface PickRequest {
	title: string;
	listOptions: PickOption[];
	/** Checkbox list when true; single choice otherwise. */
	multi?: boolean;
}

export interface TextRequest {
	title: string;
	prompt?: string;
	value?: string;
	/** A multi-line editor — what a commit message deserves and an InputBox cannot give. */
	multiline?: boolean;
	/** Refuse an empty (all-whitespace) answer. */
	required?: boolean;
}

export interface UserPrompt {
	/** True only on explicit confirmation; dismissal of any kind is false. */
	confirm(request: ConfirmRequest): Promise<boolean>;
	/** Selected option ids in `listOptions` order, or undefined when dismissed. */
	pickOptions(request: PickRequest): Promise<string[] | undefined>;
	/** The entered text, or undefined when dismissed (or empty while `required`). */
	inputText(request: TextRequest): Promise<string | undefined>;
}
