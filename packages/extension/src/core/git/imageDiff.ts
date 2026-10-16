import { UNCOMMITTED_HASH } from '@git-octopus/shared';
import type { FileDiffRequest } from './gitService.js';

/** Where one side of a file is read from: a commit, the index, or the file on disk. */
export type BlobSource =
	| { kind: 'rev'; rev: string; path: string }
	| { kind: 'index'; path: string }
	| { kind: 'disk'; path: string };

/** Past this, a side is not sent to the view: a data URI that size makes the webview crawl. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MAP_IMAGE_MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	bmp: 'image/bmp',
	ico: 'image/x-icon',
	avif: 'image/avif',
	svg: 'image/svg+xml',
};

/** The image type of a path by its extension, or null for anything that is not an image. */
export function imageMime(path: string): string | null {
	const dot = path.lastIndexOf('.');
	if (dot === -1 || dot < path.lastIndexOf('/')) return null;
	return MAP_IMAGE_MIME[path.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * The two sides of a diff, as the text diff of the same request reads them: a commit against its
 * first parent, a range end to end, and a working-tree file by the part asked for — unstaged
 * (index → disk), staged (HEAD → index), or all of it (HEAD → disk). A side that does not exist
 * there, like the before of an added file, simply reads as missing.
 */
export function imageSides(
	request: FileDiffRequest,
	listParents: string[]
): { before: BlobSource | null; after: BlobSource | null } {
	const beforePath = request.oldPath ?? request.path;
	const path = request.path;
	if (request.hash) {
		return {
			before: listParents[0] ? { kind: 'rev', rev: listParents[0], path: beforePath } : null,
			after: { kind: 'rev', rev: request.hash, path },
		};
	}
	if (request.fromHash && request.toHash) {
		return {
			before: { kind: 'rev', rev: request.fromHash, path: beforePath },
			after:
				request.toHash === UNCOMMITTED_HASH
					? { kind: 'disk', path }
					: { kind: 'rev', rev: request.toHash, path },
		};
	}
	if (request.untracked) return { before: null, after: { kind: 'disk', path } };
	if (request.side === 'unstaged') {
		return { before: { kind: 'index', path }, after: { kind: 'disk', path } };
	}
	if (request.side === 'staged') {
		return {
			before: { kind: 'rev', rev: 'HEAD', path: beforePath },
			after: { kind: 'index', path },
		};
	}
	return { before: { kind: 'rev', rev: 'HEAD', path: beforePath }, after: { kind: 'disk', path } };
}
