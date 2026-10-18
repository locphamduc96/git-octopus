import type {
	CredentialReplyMessage,
	CredentialRequestMessage,
	HostToWebview,
} from '@git-octopus/shared';
import {
	CONFIRM_NO,
	CONFIRM_YES,
	classifyPrompt,
} from '@git-octopus/host/adapters/askpass/askpassProtocol';
import type {
	CredentialPrompt,
	CredentialRequest,
} from '@git-octopus/host/app/ports/credentialPrompt';

interface Pending {
	message: CredentialRequestMessage;
	resolve: (answer: string | undefined) => void;
	release: () => void;
}

/**
 * The {@link CredentialPrompt} port on the app's own view: a question goes to the window as a
 * `credentialRequest`, and the typed answer comes back as a `credentialReply`. The answer lives
 * only in the promise handed to the askpass core — nothing here logs it or keeps it.
 */
export class ViewCredentialPrompt implements CredentialPrompt {
	private nextId = 1;
	private readonly mapPending = new Map<number, Pending>();

	public constructor(private readonly post: (message: HostToWebview) => void) {}

	public ask(request: CredentialRequest, signal: AbortSignal): Promise<string | undefined> {
		if (signal.aborted) return Promise.resolve(undefined);
		const id = this.nextId++;
		const message: CredentialRequestMessage = {
			type: 'credentialRequest',
			id,
			title: request.title,
			prompt: request.prompt,
			secret: request.secret,
			// A host key to trust arrives as a secret question; it deserves buttons, not a masked field.
			confirm: classifyPrompt(request.prompt).kind === 'confirm',
		};
		return new Promise((resolve) => {
			const onAbort = (): void => {
				this.settle(id, undefined, true);
			};
			signal.addEventListener('abort', onAbort, { once: true });
			this.mapPending.set(id, {
				message,
				resolve,
				release: () => signal.removeEventListener('abort', onAbort),
			});
			this.post(message);
		});
	}

	/** The view answered. A reply for a question no longer open is ignored. */
	public receiveReply(reply: CredentialReplyMessage): void {
		const pending = this.mapPending.get(reply.id);
		if (!pending) return;
		this.settle(reply.id, this.answerFor(pending.message, reply.answer), false);
	}

	/** A view that began listening after the question was asked gets it again. */
	public resend(post: (message: HostToWebview) => void = this.post): void {
		for (const { message } of this.mapPending.values()) post(message);
	}

	/** Nobody left to answer: every open question is withdrawn and refused. */
	public cancelAll(): void {
		for (const id of [...this.mapPending.keys()]) this.settle(id, undefined, true);
	}

	public get openCount(): number {
		return this.mapPending.size;
	}

	/** A yes/no question accepts only those two words; anything else is no decision at all. */
	private answerFor(
		message: CredentialRequestMessage,
		raw: string | undefined
	): string | undefined {
		if (!message.confirm) return raw;
		if (raw === CONFIRM_YES || raw === CONFIRM_NO) return raw;
		return undefined;
	}

	private settle(id: number, answer: string | undefined, withdraw: boolean): void {
		const pending = this.mapPending.get(id);
		if (!pending) return;
		this.mapPending.delete(id);
		pending.release();
		if (withdraw) this.post({ type: 'credentialCancel', id });
		pending.resolve(answer);
	}
}
