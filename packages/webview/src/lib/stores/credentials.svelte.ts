import type { CredentialRequestMessage } from '@git-octopus/shared';
import { onHostType } from '../hostRouter';
import { postToDesktop } from './desktopHost';

/**
 * Questions git or ssh is waiting on, asked by the desktop host (VS Code asks in its own native UI
 * and sends none of these). Git's words arrive as data and are only ever shown as text.
 */
export type CredentialQuestion = Omit<CredentialRequestMessage, 'type'>;

let listQuestions = $state<CredentialQuestion[]>([]);

function remove(id: number): void {
	listQuestions = listQuestions.filter((question) => question.id !== id);
}

onHostType('credentialRequest', ({ id, title, prompt, secret, confirm }) => {
	// The host asks again when this page reloads; a question it already sent is not a second one.
	if (listQuestions.some((question) => question.id === id)) return;
	listQuestions = [...listQuestions, { id, title, prompt, secret, confirm }];
});

onHostType('credentialCancel', ({ id }) => remove(id));

export const credentials = {
	/** The question on screen: the host asks one at a time, so this is almost always the only one. */
	get current(): CredentialQuestion | null {
		return listQuestions[0] ?? null;
	},
	answer(id: number, answer: string): void {
		remove(id);
		postToDesktop({ type: 'credentialReply', id, answer });
	},
	/** No answer: git then fails the command instead of waiting for one. */
	cancel(id: number): void {
		remove(id);
		postToDesktop({ type: 'credentialReply', id });
	},
};
