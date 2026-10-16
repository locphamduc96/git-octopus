import { describe, expect, it } from 'vitest';
import { lfsPatterns, parseLfsPointer, sidesFromHunks } from './lfs.js';

const OID = 'a'.repeat(64);
const pointer = (oid = OID, size = 1234) =>
	`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`;

describe('parseLfsPointer', () => {
	it('reads the hash and size of a pointer', () => {
		expect(parseLfsPointer(pointer())).toEqual({ oid: OID, size: 1234 });
	});

	it('refuses anything that is not the spec: a missing key, another version, ordinary text', () => {
		expect(parseLfsPointer(`version https://git-lfs.github.com/spec/v1\nsize 3\n`)).toBeNull();
		expect(parseLfsPointer(pointer().replace('spec/v1', 'spec/v2'))).toBeNull();
		expect(parseLfsPointer('const a = 1;\nconst b = 2;\nconst c = 3;\n')).toBeNull();
	});
});

describe('sidesFromHunks', () => {
	it('splits the hunks back into the old and the new text', () => {
		const line = (kind: 'add' | 'del' | 'context', text: string) => ({
			kind,
			text,
			oldLine: null,
			newLine: null,
		});
		expect(
			sidesFromHunks([
				{
					oldStart: 1,
					newStart: 1,
					heading: '',
					listLines: [line('context', 'v'), line('del', 'old'), line('add', 'new')],
				},
			])
		).toEqual({ before: 'v\nold', after: 'v\nnew' });
	});
});

describe('lfsPatterns', () => {
	it('lists the patterns sent through the LFS filter, skipping comments and others', () => {
		const attributes = [
			'# assets',
			'*.psd filter=lfs diff=lfs merge=lfs -text',
			'*.ts text eol=lf',
			'assets/**/*.wav filter=lfs diff=lfs merge=lfs -text',
		].join('\n');
		expect(lfsPatterns(attributes)).toEqual(['*.psd', 'assets/**/*.wav']);
	});
});
