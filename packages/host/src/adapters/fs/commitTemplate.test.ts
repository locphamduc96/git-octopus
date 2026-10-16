import { describe, expect, it } from 'vitest';
import { fakeGit } from '../../test/fakeGit';
import { cleanTemplate, readCommitTemplate, templatePath } from './commitTemplate';

describe('cleanTemplate', () => {
	it('drops comment lines and the blank lines at either end', () => {
		expect(cleanTemplate('\n[TICKET] \n\nWhy:\n# lines starting with # are ignored\n\n')).toBe(
			'[TICKET] \n\nWhy:'
		);
	});
});

describe('templatePath', () => {
	it('expands ~/ to the home directory and takes a relative path from the repository', () => {
		expect(templatePath('~/.gitmessage', '/repo', '/home/ada')).toBe('/home/ada/.gitmessage');
		expect(templatePath('.github/commit.txt', '/repo', '/home/ada')).toBe(
			'/repo/.github/commit.txt'
		);
		expect(templatePath('/etc/msg', '/repo', '/home/ada')).toBe('/etc/msg');
	});
});

describe('readCommitTemplate', () => {
	it('is null when no template is configured', async () => {
		const git = fakeGit({ 'config --get commit.template': '' });
		expect(await readCommitTemplate(git, '/repo', () => Promise.resolve('x'), '/home')).toBeNull();
	});

	it('reads and cleans the configured file, and is null when it cannot be read', async () => {
		const git = fakeGit({ 'config --get commit.template': '~/.gitmessage\n' });
		const read = (file: string) =>
			file === '/home/.gitmessage'
				? Promise.resolve('feat: \n# hint\n')
				: Promise.reject(new Error());
		expect(await readCommitTemplate(git, '/repo', read, '/home')).toBe('feat:');
		expect(
			await readCommitTemplate(git, '/repo', () => Promise.reject(new Error('gone')), '/home')
		).toBeNull();
	});
});
