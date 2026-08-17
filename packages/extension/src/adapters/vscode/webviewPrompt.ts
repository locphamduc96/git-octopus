import { randomBytes } from 'node:crypto';
import type { UiReplyMessage, UiRequestMessage, UiRequestPayload } from '@git-octopus/shared';
import type {
	ConfirmRequest,
	PickRequest,
	TextRequest,
	UserPrompt,
} from '../../app/ports/userPrompt.js';

/** How long a question may sit in the webview before the host withdraws it. */
const REQUEST_TIMEOUT_MS = 2 * 60 * 1000;

interface Pending {
	resolve: (reply: UiReplyMessage | undefined) => void;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * One broker per attached webview: turns {@link UserPrompt} calls into `uiRequest` messages and
 * matches `uiReply` answers back by their single-use random id. The codebase's first requestId
 * infrastructure — the request-broker work planned for the next update rides this same shape.
 *
 * Trust model: a forged or replayed reply can at most answer a question that is genuinely open
 * in that same webview — ids are unguessable, one-shot, and this broker only ever receives
 * replies the provider routed from the webview the request was sent to. What a reply approves
 * is still re-proven host-side before anything destructive runs.
 */
export class WebviewPromptBroker implements UserPrompt {
	private readonly mapPending = new Map<string, Pending>();

	public constructor(
		private readonly post: (message: UiRequestMessage | { type: 'uiDismiss'; requestId: string }) => void
	) {}

	public async confirm(request: ConfirmRequest): Promise<boolean> {
		const reply = await this.request({ kind: 'confirm', ...request });
		return reply?.confirmed === true;
	}

	public async pickOptions(request: PickRequest): Promise<string[] | undefined> {
		const reply = await this.request({ kind: 'pick', ...request });
		if (!reply || reply.cancelled || !Array.isArray(reply.listSelected)) return undefined;
		// Only ids that were actually offered, in offer order — a hostile reply cannot invent one.
		const setOffered = new Set(request.listOptions.map((option) => option.id));
		return reply.listSelected.filter((id) => setOffered.has(id));
	}

	public async inputText(request: TextRequest): Promise<string | undefined> {
		const reply = await this.request({ kind: 'text', ...request });
		if (!reply || reply.cancelled || typeof reply.text !== 'string') return undefined;
		if (request.required && reply.text.trim() === '') return undefined;
		return reply.text;
	}

	/** Route a reply from the webview this broker belongs to. Unknown or reused ids are dropped. */
	public handleReply(message: UiReplyMessage): void {
		const pending = this.mapPending.get(message.requestId);
		if (!pending) return;
		this.mapPending.delete(message.requestId);
		clearTimeout(pending.timer);
		pending.resolve(message);
	}

	/** The webview is gone (dispose, repo switch): every open question resolves as dismissed. */
	public cancelAll(): void {
		for (const [, pending] of this.mapPending) {
			clearTimeout(pending.timer);
			pending.resolve(undefined);
		}
		this.mapPending.clear();
	}

	private request(payload: UiRequestPayload): Promise<UiReplyMessage | undefined> {
		const requestId = randomBytes(16).toString('hex');
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.mapPending.delete(requestId);
				this.post({ type: 'uiDismiss', requestId });
				resolve(undefined);
			}, REQUEST_TIMEOUT_MS);
			this.mapPending.set(requestId, { resolve, timer });
			this.post({ type: 'uiRequest', requestId, payload });
		});
	}
}
