import { describe, expect, it } from 'vitest';
import { buildFileMenu } from './fileMenu';

const ids = (options: Parameters<typeof buildFileMenu>[0]): string[] =>
	buildFileMenu(options).map((item) => item.id);

describe('buildFileMenu', () => {
	it('offers the diff, the file and its paths', () => {
		expect(ids({})).toEqual(['openChanges', 'openFile', 'copyPath', 'copyRelativePath']);
	});

	it('offers the revision only while a commit is on screen', () => {
		expect(ids({ atRevision: true })).toContain('openFileAtRev');
		expect(ids({})).not.toContain('openFileAtRev');
	});

	it('drops both open-file entries for a file the commit deleted', () => {
		const listIds = ids({ atRevision: true, deleted: true });
		expect(listIds).not.toContain('openFile');
		expect(listIds).not.toContain('openFileAtRev');
		// The diff still works: it is the only way left to see what the commit removed.
		expect(listIds[0]).toBe('openChanges');
	});

	it('appends the row actions behind a separator', () => {
		const listItems = buildFileMenu({
			listActions: [
				{ id: 'stage', label: 'Stage' },
				{ id: 'discard', label: 'Discard Changes' },
			],
		});
		expect(listItems.at(-2)).toEqual({ id: 'stage', label: 'Stage', separatorBefore: true });
		expect(listItems.at(-1)).toEqual({
			id: 'discard',
			label: 'Discard Changes',
			separatorBefore: false,
		});
	});
});
