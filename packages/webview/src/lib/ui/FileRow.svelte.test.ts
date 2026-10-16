import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import FileRow from './FileRow.svelte';

describe('FileRow submodule', () => {
	it('says what moved inside a submodule, in place of the file icon', () => {
		const { container } = render(FileRow, {
			file: {
				status: 'M',
				path: 'libs/engine',
				submodule: { commitChanged: true, modified: false, untracked: true },
			},
			onopen: () => {},
		});
		expect(screen.getByText('new commits · untracked content')).toBeTruthy();
		expect(container.querySelector('.codicon-file-submodule')).not.toBeNull();
	});

	it('labels a submodule from a commit, which has no working state', () => {
		render(FileRow, {
			file: { status: 'A', path: 'libs/engine', submodule: {} },
			onopen: () => {},
		});
		expect(screen.getByText('submodule')).toBeTruthy();
	});

	it('leaves an ordinary file as it was', () => {
		const { container } = render(FileRow, {
			file: { status: 'M', path: 'src/a.ts' },
			onopen: () => {},
		});
		expect(container.querySelector('.codicon-file-submodule')).toBeNull();
	});
});
