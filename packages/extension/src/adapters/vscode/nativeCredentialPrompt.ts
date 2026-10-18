import * as vscode from 'vscode';
import type {
	CredentialPrompt,
	CredentialRequest,
} from '@git-octopus/host/app/ports/credentialPrompt';
import {
	CONFIRM_NO,
	CONFIRM_YES,
	classifyPrompt,
} from '@git-octopus/host/adapters/askpass/askpassProtocol';

/**
 * The {@link CredentialPrompt} port on native VS Code UI: an input box for a username or a
 * password, a quick pick for a yes/no question. Credentials never go through the webview.
 */
export const nativeCredentialPrompt: CredentialPrompt = {
	async ask(request: CredentialRequest, signal: AbortSignal): Promise<string | undefined> {
		// Every prompt is taken down the moment its git process is gone: one that outlived its
		// asker can only collect an answer nobody will read, and while it is up the next command's
		// prompt is behind it.
		const cancel = new vscode.CancellationTokenSource();
		const onAbort = (): void => cancel.cancel();
		signal.addEventListener('abort', onAbort, { once: true });
		try {
			return classifyPrompt(request.prompt).kind === 'confirm'
				? await askConfirm(request, cancel.token)
				: await askText(request, cancel.token);
		} finally {
			signal.removeEventListener('abort', onAbort);
			cancel.dispose();
		}
	},
};

/**
 * A yes/no question, asked with a quick pick rather than a modal dialog.
 *
 * A modal cannot be dismissed by anything but the user, so one left behind by a timed-out
 * prompt sits over the window and blocks the next authentication prompt outright. The quick
 * pick takes a cancellation token and goes away on its own. It is still native editor chrome,
 * like the input box the passwords use — nothing about this question reaches the webview.
 */
async function askConfirm(
	request: CredentialRequest,
	token: vscode.CancellationToken
): Promise<string | undefined> {
	const pick = await vscode.window.showQuickPick(
		// Refusal first, so the highlighted answer to a question the user did not expect is the
		// one that changes nothing.
		[
			{ label: 'No', description: 'Refuse and stop the operation', value: CONFIRM_NO },
			{ label: 'Yes', description: 'Allow the operation to continue', value: CONFIRM_YES },
		],
		{ title: request.title, placeHolder: request.prompt, ignoreFocusOut: true },
		token
	);
	return pick?.value;
}

function askText(
	request: CredentialRequest,
	token: vscode.CancellationToken
): Thenable<string | undefined> {
	return vscode.window.showInputBox(
		{
			title: request.title,
			prompt: request.prompt,
			password: request.secret,
			ignoreFocusOut: true,
		},
		token
	);
}
