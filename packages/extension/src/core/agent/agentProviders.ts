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
}

export interface AgentProvider {
	id: AgentId;
	label: string;
	bin: string;
	runSpec(): AgentRunSpec;
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
	runSpec() {
		// -p reads the prompt from stdin and exits after one answer; the JSON envelope carries
		// the answer in `result`.
		return { bin: this.bin, listArgs: ['-p', '--output-format', 'json'] };
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
	runSpec() {
		// `exec -` reads the prompt from stdin; --json emits JSONL events, the last agent_message
		// of which is the answer. --skip-git-repo-check: we already know we are in a repo, and the
		// check is one more way for the flag surface to drift under us.
		return { bin: this.bin, listArgs: ['exec', '--json', '--skip-git-repo-check', '-'] };
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

export const LIST_AGENT_PROVIDERS: AgentProvider[] = [claude, codex];

export function providerById(id: string | null | undefined): AgentProvider | undefined {
	return LIST_AGENT_PROVIDERS.find((provider) => provider.id === id);
}
