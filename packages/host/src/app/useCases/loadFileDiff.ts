import type {
	FileDiffMessage,
	HostToWebview,
	ImageSide,
	LfsPointer,
	LoadFileDiffMessage,
} from '@git-octopus/shared';
import { countDiffLines } from '../../core/git/diffParser.js';
import { getFileDiff, getParents, type FileDiffRequest } from '../../core/git/gitService.js';
import { imageMime, imageSides, MAX_IMAGE_BYTES } from '../../core/git/imageDiff.js';
import type { BlobRead } from '../ports/blobReader.js';
import { parseLfsPointer, sidesFromHunks } from '../../core/git/lfs.js';
import { submoduleDiff } from '../../core/git/submodules.js';
import type { RepoContext } from './loadCommits.js';

/**
 * A ceiling on what the view is asked to draw. The whole-file mode asks git for more context than
 * any file has, so a generated bundle would otherwise arrive as one hunk of a hundred thousand
 * lines — cheap for git, and the thing that would make the webview stutter.
 */
const MAX_LINES = 20000;

/** Load one file's diff as hunks, for the in-view diff panel. */
export async function loadFileDiff(
	ctx: RepoContext,
	message: LoadFileDiffMessage
): Promise<HostToWebview> {
	if (!ctx.cwd) {
		return {
			type: 'error',
			message: 'No Git repository is open in this workspace.',
			repos: ctx.repos,
			activeRepo: null,
			source: 'loadFileDiff',
		};
	}
	const request: FileDiffRequest = {
		path: message.path,
		oldPath: message.oldPath,
		hash: message.hash,
		fromHash: message.fromHash,
		toHash: message.toHash,
		untracked: message.untracked,
		context: message.context,
		ignoreWhitespace: message.ignoreWhitespace,
		side: message.side,
	};
	const result = await getFileDiff(ctx.executor, ctx.cwd, request);
	const reply = (extra: Partial<FileDiffMessage>): FileDiffMessage => ({
		type: 'fileDiff',
		key: message.key,
		path: message.path,
		listHunks: [],
		...extra,
	});
	const mime = imageMime(message.path);
	const cwd = ctx.cwd;
	const readBlob = ctx.readBlob;

	if (!result.binary && result.listHunks.length > 0) {
		const texts = sidesFromHunks(result.listHunks);
		// A submodule diffs as one line a side, "Subproject commit <id>": the pointer, not a change
		// anyone reads as text. The repository it points into is the place to look.
		const repoPath =
			ctx.repos.find((repo) => repo.parent === cwd && repo.subPath === message.path)?.path ?? null;
		const submodule = submoduleDiff(texts.before, texts.after, repoPath);
		if (submodule) return reply({ submodule });

		// A file Git LFS stores diffs as its pointer: three lines of hash and size that say nothing.
		// What they point at is what the view shows instead.
		const lfs = {
			before: parseLfsPointer(texts.before) ?? undefined,
			after: parseLfsPointer(texts.after) ?? undefined,
		};
		if (lfs.before || lfs.after) {
			// With git-lfs installed the working tree holds the real file: an image can still be shown.
			const onDisk = imageSides(request, []).after;
			if (mime && readBlob && onDisk?.kind === 'disk') {
				const read = await readBlob(cwd, onDisk, MAX_IMAGE_BYTES);
				if (typeof read === 'object' && !pointerIn(read)) {
					return reply({ lfs, image: { after: imageSide(mime, read) } });
				}
			}
			return reply({ lfs });
		}
	}

	if (result.binary && mime && readBlob) {
		const listParents = message.hash
			? await getParents(ctx.executor, cwd, message.hash).catch(() => [])
			: [];
		const sides = imageSides(request, listParents);
		const read = (source: (typeof sides)['before']): Promise<BlobRead> =>
			source ? readBlob(cwd, source, MAX_IMAGE_BYTES) : Promise.resolve('missing');
		const [before, after] = await Promise.all([read(sides.before), read(sides.after)]);
		if (before === 'tooLarge' || after === 'tooLarge') {
			return reply({
				notice: 'This image is larger than 5 MB — open it in the editor to view it.',
			});
		}
		// Without git-lfs, a committed side is the pointer while the disk holds the image itself.
		const lfs = { before: pointerIn(before) ?? undefined, after: pointerIn(after) ?? undefined };
		const image = {
			before: typeof before === 'object' && !lfs.before ? imageSide(mime, before) : undefined,
			after: typeof after === 'object' && !lfs.after ? imageSide(mime, after) : undefined,
		};
		if (image.before || image.after || lfs.before || lfs.after) {
			return reply({
				...(image.before || image.after ? { image } : {}),
				...(lfs.before || lfs.after ? { lfs } : {}),
			});
		}
	}
	const total = countDiffLines(result.listHunks);
	if (total > MAX_LINES) {
		return {
			type: 'fileDiff',
			key: message.key,
			path: message.path,
			listHunks: [],
			notice: `This diff is ${total.toLocaleString()} lines — too large to draw here. Switch to changes only, or open it in the editor.`,
		};
	}
	return {
		type: 'fileDiff',
		key: message.key,
		path: message.path,
		listHunks: result.listHunks,
		notice: result.notice,
	};
}

/** A blob read for the view, as an inline image. */
function imageSide(mime: string, read: { base64: string; bytes: number }): ImageSide {
	return { dataUri: `data:${mime};base64,${read.base64}`, bytes: read.bytes };
}

/** The LFS pointer a small blob is, if it is one — real images are never this small and textual. */
function pointerIn(read: BlobRead): LfsPointer | null {
	if (typeof read !== 'object' || read.bytes > 1024) return null;
	return parseLfsPointer(atob(read.base64));
}
