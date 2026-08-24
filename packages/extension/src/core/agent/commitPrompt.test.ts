import { describe, expect, it } from 'vitest';
import {
	buildCommitPrompt,
	MAX_DIFF_LINES_PER_FILE,
	MAX_TOTAL_DIFF_CHARS,
	type PromptFile,
} from './commitPrompt.js';

function source(path: string, diff: string): PromptFile {
	return { path, status: 'M', tier: 'source', diff };
}

describe('buildCommitPrompt', () => {
	it('always lists every file name, even the ones whose content stays home', () => {
		const prompt = buildCommitPrompt({
			branch: 'feat/x',
			listRecentSubjects: ['feat: earlier work'],
			listFiles: [
				source('src/a.ts', '+++ a'),
				{ path: 'big.scene', status: 'M', tier: 'asset', additions: 900, deletions: 100 },
				{ path: 'hero.png', status: 'A', tier: 'binary' },
				{ path: 'secret.env', status: 'M', tier: 'excluded' },
			],
		});
		expect(prompt).toContain('src/a.ts');
		expect(prompt).toContain('big.scene — modified (+900/-100) [generated/large: content not shown]');
		expect(prompt).toContain('hero.png — added [binary]');
		expect(prompt).toContain('secret.env — modified [excluded from AI input]');
		expect(prompt).toContain('feat: earlier work');
		expect(prompt).toContain('Branch: feat/x');
	});

	it('cuts a single oversized diff instead of letting it flood the prompt', () => {
		const diff = Array.from({ length: MAX_DIFF_LINES_PER_FILE + 50 }, (_, i) => `+line ${i}`).join(
			'\n'
		);
		const prompt = buildCommitPrompt({
			branch: null,
			listRecentSubjects: [],
			listFiles: [source('src/a.ts', diff)],
		});
		expect(prompt).toContain('more lines truncated');
		expect(prompt).not.toContain(`+line ${MAX_DIFF_LINES_PER_FILE + 10}`);
	});

	it('spends the total budget on the smallest diffs first', () => {
		const small = source('src/small.ts', '+one line');
		const huge = source('src/huge.ts', '+x'.repeat(MAX_TOTAL_DIFF_CHARS));
		const prompt = buildCommitPrompt({
			branch: null,
			listRecentSubjects: [],
			listFiles: [huge, small],
		});
		expect(prompt).toContain('--- src/small.ts ---');
		expect(prompt).not.toContain('--- src/huge.ts ---');
		// The dropped file is still named in the listing, so the plan can still place it.
		expect(prompt).toContain('src/huge.ts — modified');
	});
});
