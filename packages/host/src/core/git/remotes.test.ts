import { describe, expect, it } from 'vitest';
import { parseRemotes } from './remotes';

describe('parseRemotes', () => {
	it('reads each remote once, keeping the push URL only when it differs', () => {
		const output = [
			'origin\tgit@github.com:a/app.git (fetch)',
			'origin\tgit@github.com:a/app.git (push)',
			'mirror\thttps://example.com/app.git (fetch)',
			'mirror\tgit@example.com:app.git (push)',
			'',
		].join('\n');
		expect(parseRemotes(output)).toEqual([
			{ name: 'origin', fetchUrl: 'git@github.com:a/app.git' },
			{
				name: 'mirror',
				fetchUrl: 'https://example.com/app.git',
				pushUrl: 'git@example.com:app.git',
			},
		]);
	});

	it('is empty for a repository with no remote', () => {
		expect(parseRemotes('')).toEqual([]);
	});
});
