import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import type { BlobRead, BlobReader } from '../../app/ports/blobReader.js';

/** Run git and collect stdout as bytes; rejects on a non-zero exit. */
function gitBytes(args: string[], cwd: string): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const child = spawn('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
		const listChunks: Buffer[] = [];
		child.stdout.on('data', (chunk: Buffer) => listChunks.push(chunk));
		child.on('error', reject);
		child.on('close', (code) =>
			code === 0 ? resolve(Buffer.concat(listChunks)) : reject(new Error(`git exited ${code}`))
		);
	});
}

/**
 * Read one side of a binary file. A commit or the index is read with `cat-file` — plumbing, no
 * lock — after its size is checked, so an oversized blob is never pulled into memory.
 */
export const readBlob: BlobReader = async (cwd, source, maxBytes): Promise<BlobRead> => {
	try {
		if (source.kind === 'disk') {
			const absolute = path.join(cwd, source.path);
			const info = await stat(absolute);
			if (!info.isFile()) return 'missing';
			if (info.size > maxBytes) return 'tooLarge';
			const data = await readFile(absolute);
			return { base64: data.toString('base64'), bytes: data.length };
		}
		const spec = source.kind === 'index' ? `:${source.path}` : `${source.rev}:${source.path}`;
		const size = Number((await gitBytes(['cat-file', '-s', spec], cwd)).toString('utf8').trim());
		if (!Number.isFinite(size)) return 'missing';
		if (size > maxBytes) return 'tooLarge';
		const data = await gitBytes(['cat-file', 'blob', spec], cwd);
		return { base64: data.toString('base64'), bytes: data.length };
	} catch {
		return 'missing';
	}
};
