import type { AgentId } from '@git-octopus/shared';

/**
 * The two supported agent CLIs, described declaratively: how to invoke one non-interactively,
 * how to unwrap its output envelope, and how to recognize "you are not logged in".
 *
 * Both are used the same way — prompt on stdin, JSON out, no tools — so adding another agent
 * later is one more entry here, not a new code path.
 */

export interface AgentRunSpec {
	bin: string;
	listArgs: string[];
	/** The prompt goes on the end of `listArgs` instead of stdin (CLIs that cannot read a pipe). */
	promptInArgs?: boolean;
}

export interface AgentProvider {
	id: AgentId;
	label: string;
	bin: string;
	/** How to invoke one non-interactive run; `model`/`thinking` override CLI defaults when set. */
	runSpec(model?: string, thinking?: string): AgentRunSpec;
	/** Pull the agent's answer text out of the CLI's own output envelope. */
	extractText(stdout: string): string;
	/** Whether this output means the CLI wants a login, not that the request was bad. */
	needsLogin(output: string): boolean;
}

function parseJsonLine(line: string): Record<string, unknown> | null {
	try {
		const value = JSON.parse(line) as unknown;
		return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

const claude: AgentProvider = {
	id: 'claude',
	label: 'Claude Code',
	bin: 'claude',
	runSpec(model?: string, thinking?: string) {
		// -p reads the prompt from stdin and exits after one answer; the JSON envelope carries
		// the answer in `result`.
		const listArgs = ['-p', '--output-format', 'json'];
		if (model) listArgs.push('--model', model);
		if (thinking) listArgs.push('--effort', thinking);
		return { bin: this.bin, listArgs };
	},
	extractText(stdout: string): string {
		const envelope = parseJsonLine(stdout.trim());
		if (envelope && typeof envelope.result === 'string') return envelope.result;
		// Some versions emit one JSON object per line; the result line is the one that matters.
		for (const line of stdout.trim().split('\n').reverse()) {
			const parsed = parseJsonLine(line);
			if (parsed && typeof parsed.result === 'string') return parsed.result;
		}
		return stdout;
	},
	needsLogin(output: string): boolean {
		return /invalid api key|please run \/login|not logged in|oauth token.*(expired|revoked)|authentication[_ ]error/i.test(
			output
		);
	},
};

const codex: AgentProvider = {
	id: 'codex',
	label: 'Codex CLI',
	bin: 'codex',
	runSpec(model?: string, thinking?: string) {
		// `exec -` reads the prompt from stdin; --json emits JSONL events, the last agent_message
		// of which is the answer. --skip-git-repo-check: we already know we are in a repo, and the
		// check is one more way for the flag surface to drift under us.
		const listArgs = ['exec', '--json', '--skip-git-repo-check'];
		if (model) listArgs.push('-m', model);
		if (thinking) listArgs.push('-c', `model_reasoning_effort=${thinking}`);
		listArgs.push('-');
		return { bin: this.bin, listArgs };
	},
	extractText(stdout: string): string {
		let text: string | null = null;
		for (const line of stdout.split('\n')) {
			const event = parseJsonLine(line);
			if (!event) continue;
			// Two envelope generations: {"msg":{"type":"agent_message","message":…}} and
			// {"type":"item.completed","item":{"type":"agent_message","text":…}}.
			const msg = event.msg as Record<string, unknown> | undefined;
			if (msg && msg.type === 'agent_message' && typeof msg.message === 'string') {
				text = msg.message;
			}
			const item = event.item as Record<string, unknown> | undefined;
			if (item && item.type === 'agent_message' && typeof item.text === 'string') {
				text = item.text;
			}
		}
		return text ?? stdout;
	},
	needsLogin(output: string): boolean {
		return /not logged in|codex login|401 unauthorized|missing.*api key|openai_api_key/i.test(
			output
		);
	},
};

const gemini: AgentProvider = {
	id: 'gemini',
	label: 'Gemini CLI',
	bin: 'gemini',
	runSpec(model?: string) {
		// Reads the prompt from stdin; --output-format json wraps the answer as {"response": …}.
		const listArgs = ['--output-format', 'json'];
		if (model) listArgs.push('-m', model);
		return { bin: this.bin, listArgs };
	},
	extractText(stdout: string): string {
		const envelope = parseJsonLine(stdout.trim());
		if (envelope && typeof envelope.response === 'string') return envelope.response;
		return stdout;
	},
	needsLogin(output: string): boolean {
		return /not (?:logged in|authenticated)|please (?:log ?in|authenticate)|gemini_api_key|no credentials|oauth/i.test(
			output
		);
	},
};

const copilot: AgentProvider = {
	id: 'copilot',
	label: 'Copilot CLI',
	bin: 'copilot',
	runSpec(model?: string) {
		// -p takes the prompt as its value, so it sits last and the prompt rides the argv.
		const listArgs: string[] = [];
		if (model) listArgs.push('--model', model);
		listArgs.push('-p');
		return { bin: this.bin, listArgs, promptInArgs: true };
	},
	extractText(stdout: string): string {
		return stdout;
	},
	needsLogin(output: string): boolean {
		return /not (?:logged in|authenticated)|copilot login|gh auth|unauthorized/i.test(output);
	},
};

const opencode: AgentProvider = {
	id: 'opencode',
	label: 'OpenCode',
	bin: 'opencode',
	runSpec(model?: string) {
		// `run [message..]` takes the prompt as a positional; -m wants provider/model form.
		const listArgs = ['run'];
		if (model) listArgs.push('-m', model);
		return { bin: this.bin, listArgs, promptInArgs: true };
	},
	extractText(stdout: string): string {
		return stdout;
	},
	needsLogin(output: string): boolean {
		return /not (?:logged in|authenticated)|opencode auth|no credentials|missing.*api key/i.test(
			output
		);
	},
};

const qwen: AgentProvider = {
	id: 'qwen',
	label: 'Qwen Code',
	bin: 'qwen',
	runSpec(model?: string) {
		// A gemini-cli fork: prompt over stdin, -m for the model; plain text back.
		const listArgs: string[] = [];
		if (model) listArgs.push('-m', model);
		return { bin: this.bin, listArgs };
	},
	extractText(stdout: string): string {
		return stdout;
	},
	needsLogin(output: string): boolean {
		return /not (?:logged in|authenticated)|please (?:log ?in|authenticate)|dashscope|api key|oauth/i.test(
			output
		);
	},
};

export const LIST_AGENT_PROVIDERS: AgentProvider[] = [
	claude,
	codex,
	gemini,
	copilot,
	opencode,
	qwen,
];

export function providerById(id: string | null | undefined): AgentProvider | undefined {
	return LIST_AGENT_PROVIDERS.find((provider) => provider.id === id);
}
