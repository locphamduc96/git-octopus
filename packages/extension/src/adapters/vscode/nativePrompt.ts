import * as vscode from 'vscode';
import type {
	ConfirmRequest,
	PickRequest,
	TextRequest,
	UserPrompt,
} from '../../app/ports/userPrompt.js';

/**
 * The {@link UserPrompt} port on native VS Code UI — the exact dialogs the services used before
 * the port existed. Serves actions with no originating webview, and any flow whose webview
 * disappeared mid-conversation.
 */
export const nativePrompt: UserPrompt = {
	async confirm(request: ConfirmRequest): Promise<boolean> {
		const label = request.confirmLabel ?? 'Yes';
		const pick = await vscode.window.showWarningMessage(request.message, { modal: true }, label);
		return pick === label;
	},

	async pickOptions(request: PickRequest): Promise<string[] | undefined> {
		const listItems = request.listOptions.map((option) => ({
			label: option.label,
			description: option.description,
			picked: option.picked,
			id: option.id,
		}));
		if (request.multi) {
			const listPicked = await vscode.window.showQuickPick(listItems, {
				canPickMany: true,
				placeHolder: request.title,
			});
			return listPicked?.map((item) => item.id);
		}
		const picked = await vscode.window.showQuickPick(listItems, { placeHolder: request.title });
		return picked ? [picked.id] : undefined;
	},

	async inputText(request: TextRequest): Promise<string | undefined> {
		const value = await vscode.window.showInputBox({
			title: request.title,
			prompt: request.prompt,
			value: request.value,
			validateInput: request.required
				? (input) => (input.trim() === '' ? 'A value is required.' : undefined)
				: undefined,
		});
		if (value === undefined) return undefined;
		if (request.required && value.trim() === '') return undefined;
		return value;
	},
};
