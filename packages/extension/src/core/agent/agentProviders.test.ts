import { describe, expect, it } from 'vitest';
import { providerById } from './agentProviders.js';

const claude = providerById('claude')!;
const codex = providerById('codex')!;
const gemini = providerById('gemini')!;
const copilot = providerById('copilot')!;
const opencode = providerById('opencode')!;

describe('runSpec model pin', () => {
	it('passes the pinned model and thinking through the right flags, omitting them when unset', () => {
		expect(claude.runSpec('haiku', 'low').listArgs).toEqual([
			'-p', '--output-format', 'json', '--model', 'haiku', '--effort', 'low',
		]);
		expect(claude.runSpec().listArgs).toEqual(['-p', '--output-format', 'json']);
		// Codex reads the prompt from `-`, so every flag must come before it.
		expect(codex.runSpec('gpt-5-mini', 'minimal').listArgs).toEqual([
			'exec', '--json', '--skip-git-repo-check', '-m', 'gpt-5-mini',
			'-c', 'model_reasoning_effort=minimal', '-',
		]);
		expect(codex.runSpec().listArgs).toEqual(['exec', '--json', '--skip-git-repo-check', '-']);
	});
});

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

describe('gemini provider', () => {
	it('unwraps the --output-format json envelope, falling back to raw text', () => {
		expect(gemini.extractText(JSON.stringify({ response: '{"groups":[]}', stats: {} }))).toBe(
			'{"groups":[]}'
		);
		expect(gemini.extractText('plain answer')).toBe('plain answer');
	});

	it('takes the prompt on stdin and the model as -m', () => {
		const spec = gemini.runSpec('gemini-2.5-flash');
		expect(spec.promptInArgs).toBeUndefined();
		expect(spec.listArgs).toEqual(['--output-format', 'json', '-m', 'gemini-2.5-flash']);
	});
});

describe('argv-prompt providers', () => {
	it('copilot puts -p last so the appended prompt becomes its value', () => {
		const spec = copilot.runSpec('gpt-5');
		expect(spec.promptInArgs).toBe(true);
		expect(spec.listArgs).toEqual(['--model', 'gpt-5', '-p']);
	});

	it('opencode runs with the prompt as the positional message', () => {
		const spec = opencode.runSpec('anthropic/claude-haiku-4-5');
		expect(spec.promptInArgs).toBe(true);
		expect(spec.listArgs).toEqual(['run', '-m', 'anthropic/claude-haiku-4-5']);
	});
});
