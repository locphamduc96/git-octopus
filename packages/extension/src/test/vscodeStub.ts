/**
 * Enough of the `vscode` module to load an adapter under test.
 *
 * The adapters are where VS Code UI lives, so they cannot be imported at all without this — and
 * the decisions worth testing (which git commands an action runs, when it refuses, whether a
 * prompt goes away) sit in those same files. Nothing here performs anything: calls are recorded,
 * and the pickers stay open until a test answers them or their token is cancelled.
 */
export interface OpenPrompt {
	kind: 'quickPick' | 'inputBox';
	title: string | undefined;
	/** Resolve as if the user had answered; undefined stands for dismissal. */
	answer: (value: unknown) => void;
	/** True once the token cancelled it — what "the prompt left the screen" looks like here. */
	cancelled: boolean;
	settled: boolean;
}

export interface StubRecord {
	listInfo: string[];
	listErrors: string[];
	listClipboard: string[];
	listOpened: string[];
	/** Every picker shown, in order, whether or not it has been answered. */
	listPrompts: OpenPrompt[];
}

export const recorded: StubRecord = {
	listInfo: [],
	listErrors: [],
	listClipboard: [],
	listOpened: [],
	listPrompts: [],
};

export function resetRecorded(): void {
	recorded.listInfo.length = 0;
	recorded.listErrors.length = 0;
	recorded.listClipboard.length = 0;
	recorded.listOpened.length = 0;
	recorded.listPrompts.length = 0;
}

/** Prompts still on screen — none should survive their git process. */
export function openPrompts(): OpenPrompt[] {
	return recorded.listPrompts.filter((prompt) => !prompt.settled);
}

interface StubToken {
	isCancellationRequested: boolean;
	onCancellationRequested: (listener: () => void) => { dispose: () => void };
}

/** A picker that resolves when answered, or when its token is cancelled. */
function showPrompt(
	kind: OpenPrompt['kind'],
	title: string | undefined,
	token?: StubToken
): Promise<unknown> {
	return new Promise((resolve) => {
		const prompt: OpenPrompt = {
			kind,
			title,
			cancelled: false,
			settled: false,
			answer: (value) => {
				if (prompt.settled) return;
				prompt.settled = true;
				resolve(value);
			},
		};
		recorded.listPrompts.push(prompt);
		if (token) {
			if (token.isCancellationRequested) {
				prompt.cancelled = true;
				prompt.answer(undefined);
				return;
			}
			token.onCancellationRequested(() => {
				prompt.cancelled = true;
				prompt.answer(undefined);
			});
		}
	});
}

export const window = {
	showInformationMessage: (message: string): Promise<undefined> => {
		recorded.listInfo.push(message);
		return Promise.resolve(undefined);
	},
	showErrorMessage: (message: string): Promise<undefined> => {
		recorded.listErrors.push(message);
		return Promise.resolve(undefined);
	},
	showWarningMessage: (message: string): Promise<undefined> => {
		recorded.listInfo.push(message);
		return Promise.resolve(undefined);
	},
	showQuickPick: (
		_items: unknown,
		options?: { title?: string },
		token?: StubToken
	): Promise<unknown> => showPrompt('quickPick', options?.title, token),
	showInputBox: (options?: { title?: string }, token?: StubToken): Promise<unknown> =>
		showPrompt('inputBox', options?.title, token),
};

export const env = {
	clipboard: {
		writeText: (text: string): Promise<void> => {
			recorded.listClipboard.push(text);
			return Promise.resolve();
		},
	},
	openExternal: (uri: { toString: () => string }): Promise<boolean> => {
		recorded.listOpened.push(uri.toString());
		return Promise.resolve(true);
	},
};

export const Uri = {
	parse: (value: string): { toString: () => string } => ({ toString: () => value }),
};

export class CancellationTokenSource {
	private readonly listListeners: (() => void)[] = [];
	public readonly token: StubToken = {
		isCancellationRequested: false,
		onCancellationRequested: (listener: () => void) => {
			this.listListeners.push(listener);
			return { dispose: () => undefined };
		},
	};

	public cancel(): void {
		if (this.token.isCancellationRequested) return;
		this.token.isCancellationRequested = true;
		for (const listener of this.listListeners) listener();
	}

	public dispose(): void {
		this.listListeners.length = 0;
	}
}
