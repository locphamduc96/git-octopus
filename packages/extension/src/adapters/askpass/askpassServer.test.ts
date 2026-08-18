import { beforeEach, describe, expect, it } from 'vitest';
import { AskpassServer } from './askpassServer.js';
import type { PromptRequest } from './askpassCore.js';
import { openPrompts, recorded, resetRecorded } from '../../test/vscodeStub.js';

/**
 * The UI half of the bridge: whether a question actually leaves the screen when the git process
 * that asked it is gone. A prompt that outlives its asker collects an answer nobody can read, and
 * until it closes the next command's prompt is stuck behind it.
 */
function makeRequest(kind: PromptRequest['kind'], signal: AbortSignal): PromptRequest {
	return {
		context: { cwd: '/repo', operation: 'push', listHosts: ['example.invalid'] },
		kind,
		display: kind === 'confirm' ? 'Continue connecting (yes/no)?' : 'Password:',
		signal,
	};
}

/** `prompt` is private; the server owns it and hands it to the core, so reach it the same way. */
function promptOf(server: AskpassServer): (request: PromptRequest) => Promise<string | undefined> {
	return (
		server as unknown as { prompt: (r: PromptRequest) => Promise<string | undefined> }
	).prompt.bind(server);
}

beforeEach(resetRecorded);

describe('AskpassServer prompts', () => {
	it('takes a confirmation down when its git process gives up', async () => {
		const server = new AskpassServer('/ext');
		const abort = new AbortController();
		const answered = promptOf(server)(makeRequest('confirm', abort.signal));

		expect(openPrompts()).toHaveLength(1);
		expect(openPrompts()[0].kind).toBe('quickPick');

		abort.abort();
		await expect(answered).resolves.toBeUndefined();
		expect(openPrompts()).toHaveLength(0);
		expect(recorded.listPrompts[0].cancelled).toBe(true);
	});

	it('takes a credential prompt down the same way', async () => {
		const server = new AskpassServer('/ext');
		const abort = new AbortController();
		const answered = promptOf(server)(makeRequest('secret', abort.signal));

		expect(openPrompts()[0].kind).toBe('inputBox');
		abort.abort();
		await expect(answered).resolves.toBeUndefined();
		expect(openPrompts()).toHaveLength(0);
	});

	it('leaves nothing in the way of the next authentication prompt', async () => {
		// The sequence the finding describes: a confirmation times out, then another command asks.
		const server = new AskpassServer('/ext');
		const first = new AbortController();
		const stale = promptOf(server)(makeRequest('confirm', first.signal));
		first.abort();
		await stale;

		const second = new AbortController();
		const live = promptOf(server)(makeRequest('secret', second.signal));
		const listOpen = openPrompts();
		expect(listOpen).toHaveLength(1);
		expect(listOpen[0].kind).toBe('inputBox');

		listOpen[0].answer('hunter2');
		await expect(live).resolves.toBe('hunter2');
	});

	it('asks a confirmation with a cancellable picker, not a modal that only the user can close', async () => {
		const server = new AskpassServer('/ext');
		const abort = new AbortController();
		const answered = promptOf(server)(makeRequest('confirm', abort.signal));
		// A modal would have gone through showWarningMessage, which no token can dismiss.
		expect(recorded.listInfo).toEqual([]);
		expect(recorded.listPrompts[0].title).toContain('push');
		abort.abort();
		await answered;
	});

	it('answers yes and no as the protocol words', async () => {
		const server = new AskpassServer('/ext');
		const abort = new AbortController();

		const refused = promptOf(server)(makeRequest('confirm', abort.signal));
		openPrompts()[0].answer({ value: 'no' });
		await expect(refused).resolves.toBe('no');

		const allowed = promptOf(server)(makeRequest('confirm', abort.signal));
		openPrompts()[0].answer({ value: 'yes' });
		await expect(allowed).resolves.toBe('yes');
	});

	it('reads a dismissed picker as a refusal', async () => {
		const server = new AskpassServer('/ext');
		const abort = new AbortController();
		const answered = promptOf(server)(makeRequest('confirm', abort.signal));
		openPrompts()[0].answer(undefined);
		await expect(answered).resolves.toBeUndefined();
	});
});
