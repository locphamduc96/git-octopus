import { describe, expect, it } from 'vitest';
import { buildExplainPrompt } from './explainPrompt.js';

const commit = (hash: string, subject: string, body = '') => ({
	hash: hash.repeat(40),
	author: 'Ada',
	subject,
	body,
});

describe('buildExplainPrompt', () => {
	it('asks for the three sections, names the subject and lists the commits oldest first', () => {
		const prompt = buildExplainPrompt({
			title: 'branch feature — 2 commits not on main',
			listCommits: [commit('a', 'feat: one', 'why one'), commit('b', 'fix: two')],
			moreCommits: 0,
			listFiles: [{ path: 'src/a.ts', status: 'M', tier: 'source', diff: '+x' }],
		});
		expect(prompt).toContain('## Summary');
		expect(prompt).toContain('## Changes');
		expect(prompt).toContain('## Things to check');
		expect(prompt).toContain('Subject: branch feature — 2 commits not on main');
		expect(prompt.indexOf('feat: one')).toBeLessThan(prompt.indexOf('fix: two'));
		expect(prompt).toContain('    why one');
		expect(prompt).toContain('--- src/a.ts ---\n+x');
	});

	it('names files without content by name only, and says how many commits were left out', () => {
		const prompt = buildExplainPrompt({
			title: 'branch big',
			listCommits: [commit('a', 'one')],
			moreCommits: 12,
			listFiles: [
				{ path: 'secret.env', status: 'M', tier: 'excluded' },
				{ path: 'art.png', status: 'A', tier: 'binary' },
			],
		});
		expect(prompt).toContain('secret.env — modified [excluded from AI input]');
		expect(prompt).toContain('art.png — added [binary]');
		expect(prompt).toContain('… and 12 older commits not listed');
		expect(prompt).not.toContain('Diffs (');
	});

	it('asks for the configured language', () => {
		const prompt = buildExplainPrompt({
			title: 'uncommitted changes on main',
			listCommits: [],
			moreCommits: 0,
			listFiles: [],
			language: 'Vietnamese',
		});
		expect(prompt).toContain('Write the whole explanation in Vietnamese.');
		expect(prompt).not.toContain('Commits (oldest first)');
	});
});
