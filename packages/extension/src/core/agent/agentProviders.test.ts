import { describe, expect, it } from 'vitest';
import { providerById } from './agentProviders.js';

const claude = providerById('claude')!;
const codex = providerById('codex')!;

describe('claude provider', () => {
	it('unwraps the -p JSON envelope', () => {
		const stdout = JSON.stringify({
			type: 'result',
			subtype: 'success',
			result: '{"groups":[]}',
			total_cost_usd: 0.01,
		});
		expect(claude.extractText(stdout)).toBe('{"groups":[]}');
	});

	it('falls back to raw output when the envelope is not what it expects', () => {
		expect(claude.extractText('{"groups":[]}')).toBe('{"groups":[]}');
	});

	it('recognizes a login problem, which gets a terminal instead of a retry', () => {
		expect(claude.needsLogin('Invalid API key · Please run /login')).toBe(true);
		expect(claude.needsLogin('model overloaded')).toBe(false);
	});
});

describe('codex provider', () => {
	it('takes the last agent_message out of the JSONL stream (old envelope)', () => {
		const stdout = [
			JSON.stringify({ msg: { type: 'task_started' } }),
			JSON.stringify({ msg: { type: 'agent_message', message: 'thinking…' } }),
			JSON.stringify({ msg: { type: 'agent_message', message: '{"groups":[]}' } }),
		].join('\n');
		expect(codex.extractText(stdout)).toBe('{"groups":[]}');
	});

	it('reads the item.completed envelope of newer versions', () => {
		const stdout = [
			JSON.stringify({ type: 'turn.started' }),
			JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"a":1}' } }),
		].join('\n');
		expect(codex.extractText(stdout)).toBe('{"a":1}');
	});

	it('recognizes a login problem', () => {
		expect(codex.needsLogin('Not logged in. Run codex login first.')).toBe(true);
		expect(codex.needsLogin('stream disconnected')).toBe(false);
	});
});
