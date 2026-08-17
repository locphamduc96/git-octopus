import { describe, expect, it, vi } from 'vitest';
import type { UiReplyMessage, UiRequestMessage } from '@git-octopus/shared';
import { WebviewPromptBroker } from './webviewPrompt';

type Posted = UiRequestMessage | { type: 'uiDismiss'; requestId: string };

function makeBroker(): { broker: WebviewPromptBroker; listPosted: Posted[] } {
	const listPosted: Posted[] = [];
	const broker = new WebviewPromptBroker((message) => listPosted.push(message));
	return { broker, listPosted };
}

function reply(broker: WebviewPromptBroker, partial: Omit<UiReplyMessage, 'type'>): void {
	broker.handleReply({ type: 'uiReply', ...partial });
}

describe('WebviewPromptBroker', () => {
	it('resolves a confirm with the reply matching its id', async () => {
		const { broker, listPosted } = makeBroker();
		const pending = broker.confirm({ title: 'T', message: 'Sure?' });
		const request = listPosted[0] as UiRequestMessage;
		expect(request.payload).toMatchObject({ kind: 'confirm', message: 'Sure?' });
		reply(broker, { requestId: request.requestId, confirmed: true });
		expect(await pending).toBe(true);
	});

	it('treats ids as single-use — a second reply changes nothing', async () => {
		const { broker, listPosted } = makeBroker();
		const pending = broker.confirm({ title: 'T', message: 'Sure?' });
		const { requestId } = listPosted[0] as UiRequestMessage;
		reply(broker, { requestId, cancelled: true });
		reply(broker, { requestId, confirmed: true });
		expect(await pending).toBe(false);
	});

	it('ignores replies with unknown ids', async () => {
		const { broker, listPosted } = makeBroker();
		const pending = broker.confirm({ title: 'T', message: 'Sure?' });
		reply(broker, { requestId: 'guessed', confirmed: true });
		const { requestId } = listPosted[0] as UiRequestMessage;
		reply(broker, { requestId, confirmed: true });
		expect(await pending).toBe(true);
	});

	it('filters picked ids down to what was actually offered', async () => {
		const { broker, listPosted } = makeBroker();
		const pending = broker.pickOptions({
			title: 'T',
			listOptions: [
				{ id: 'a', label: 'A' },
				{ id: 'b', label: 'B' },
			],
		});
		const { requestId } = listPosted[0] as UiRequestMessage;
		reply(broker, { requestId, listSelected: ['b', 'invented'] });
		expect(await pending).toEqual(['b']);
	});

	it('refuses an empty answer to a required text request', async () => {
		const { broker, listPosted } = makeBroker();
		const pending = broker.inputText({ title: 'T', required: true });
		const { requestId } = listPosted[0] as UiRequestMessage;
		reply(broker, { requestId, text: '   ' });
		expect(await pending).toBeUndefined();
	});

	it('times out an unanswered request and withdraws it from the webview', async () => {
		vi.useFakeTimers();
		try {
			const { broker, listPosted } = makeBroker();
			const pending = broker.confirm({ title: 'T', message: 'Sure?' });
			vi.advanceTimersByTime(2 * 60 * 1000 + 1);
			expect(await pending).toBe(false);
			const { requestId } = listPosted[0] as UiRequestMessage;
			expect(listPosted[1]).toEqual({ type: 'uiDismiss', requestId });
		} finally {
			vi.useRealTimers();
		}
	});

	it('cancelAll resolves everything as dismissed', async () => {
		const { broker } = makeBroker();
		const first = broker.confirm({ title: 'T', message: 'One?' });
		const second = broker.inputText({ title: 'T' });
		broker.cancelAll();
		expect(await first).toBe(false);
		expect(await second).toBeUndefined();
	});
});
