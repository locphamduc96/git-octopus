import type { BlobSource } from '../../core/git/imageDiff.js';

/** One side of a binary file, read for the view: its bytes base64-encoded, or why it was not. */
export type BlobRead = { base64: string; bytes: number } | 'missing' | 'tooLarge';

/**
 * Port: read a file's bytes from a commit, the index or the disk. `GitExecutor` speaks text, and
 * an image is not; implemented by `adapters/process/blobReader.ts`, stubbed in tests.
 */
export type BlobReader = (cwd: string, source: BlobSource, maxBytes: number) => Promise<BlobRead>;
