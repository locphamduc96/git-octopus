import type { DiffHunk, LfsPointer } from '@git-octopus/shared';

const VERSION_LINE = /^version https:\/\/(git-lfs\.github\.com|hawser\.github\.com)\/spec\/v1$/;

/**
 * A Git LFS pointer — what git stores for a file LFS keeps elsewhere — or null for any other text:
 * the spec's version line first, then `oid sha256:<64 hex>` and `size <bytes>` among its keys.
 */
export function parseLfsPointer(text: string): LfsPointer | null {
	const listLines = text.split('\n').filter((line) => line !== '');
	if (listLines.length < 3 || listLines.length > 10 || !VERSION_LINE.test(listLines[0]))
		return null;
	const oid = listLines
		.find((line) => /^oid sha256:[0-9a-f]{64}$/.test(line))
		?.slice('oid sha256:'.length);
	const size = listLines.find((line) => /^size \d+$/.test(line))?.slice('size '.length);
	return oid && size ? { oid, size: Number(size) } : null;
}

/**
 * The old and new text a diff's hunks hold. A pointer is three short lines, so even the changes-only
 * diff carries all of it as context.
 */
export function sidesFromHunks(listHunks: DiffHunk[]): { before: string; after: string } {
	const listBefore: string[] = [];
	const listAfter: string[] = [];
	for (const hunk of listHunks) {
		for (const line of hunk.listLines) {
			if (line.kind !== 'add') listBefore.push(line.text);
			if (line.kind !== 'del') listAfter.push(line.text);
		}
	}
	return { before: listBefore.join('\n'), after: listAfter.join('\n') };
}

/** The `.gitattributes` patterns that send files through the LFS filter, in file order. */
export function lfsPatterns(gitattributes: string): string[] {
	return gitattributes
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '' && !line.startsWith('#'))
		.map((line) => line.split(/\s+/))
		.filter(([, ...listAttributes]) => listAttributes.includes('filter=lfs'))
		.map(([pattern]) => pattern);
}
