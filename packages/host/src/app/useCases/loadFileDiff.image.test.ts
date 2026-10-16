import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FileDiffMessage } from '@git-octopus/shared';
import { GitProcessExecutor } from '../../adapters/process/gitProcessExecutor.js';
import { readBlob } from '../../adapters/process/blobReader.js';
import { pathExists } from '../../adapters/fs/pathExists.js';
import { createTempRepo, type TempRepo } from '../../test/tempRepo.js';
import { loadFileDiff } from './loadFileDiff.js';

// Two different 1×1 PNGs: binary to git (their headers hold NUL bytes), real images to a browser.
const RED = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);
const BLUE = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

async function commitImage(repo: TempRepo, bytes: Buffer, message: string): Promise<string> {
	await writeFile(path.join(repo.cwd, 'logo.png'), bytes);
	await repo.git('add', 'logo.png');
	await repo.git('commit', '-qm', message);
	return (await repo.git('rev-parse', 'HEAD')).trim();
}

const load = (repo: TempRepo, over: Record<string, unknown>) =>
	loadFileDiff(
		{
			executor: new GitProcessExecutor(),
			repos: [],
			cwd: repo.cwd,
			repoName: 'repo',
			pathExists,
			readBlob,
		},
		{ type: 'loadFileDiff', key: 'k', path: 'logo.png', context: 3, ...over }
	) as Promise<FileDiffMessage>;

describe('loadFileDiff for an image against a real repository', () => {
	it('sends both sides of a changed image, and only the new side of an added one', async () => {
		const repo = await createTempRepo();
		try {
			const added = await commitImage(repo, RED, 'add logo');
			const changed = await commitImage(repo, BLUE, 'recolour logo');
			const diff = await load(repo, { hash: changed });
			expect(diff.notice).toBeUndefined();
			expect(diff.image?.before?.dataUri).toBe(`data:image/png;base64,${RED.toString('base64')}`);
			expect(diff.image?.after?.bytes).toBe(BLUE.length);
			const first = await load(repo, { hash: added });
			expect(first.image?.before).toBeUndefined();
			expect(first.image?.after?.bytes).toBe(RED.length);
		} finally {
			await repo.dispose();
		}
	});

	it('reads the working tree from disk against the index', async () => {
		const repo = await createTempRepo();
		try {
			await commitImage(repo, RED, 'add logo');
			await writeFile(path.join(repo.cwd, 'logo.png'), BLUE);
			const diff = await load(repo, { side: 'unstaged' });
			expect(diff.image?.before?.bytes).toBe(RED.length);
			expect(diff.image?.after?.dataUri).toContain(BLUE.toString('base64'));
		} finally {
			await repo.dispose();
		}
	});
});

describe('loadFileDiff for a file Git LFS stores', () => {
	const pointer = (oid: string, size: number) =>
		`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`;

	it('names the object on each side instead of drawing the pointer', async () => {
		const repo = await createTempRepo();
		try {
			await repo.commit('music.bin', pointer('a'.repeat(64), 1000), 'add music');
			const changed = await repo.commit('music.bin', pointer('b'.repeat(64), 2500), 'new mix');
			const diff = await load(repo, { path: 'music.bin', hash: changed });
			expect(diff.listHunks).toEqual([]);
			expect(diff.lfs).toEqual({
				before: { oid: 'a'.repeat(64), size: 1000 },
				after: { oid: 'b'.repeat(64), size: 2500 },
			});
		} finally {
			await repo.dispose();
		}
	});

	it('shows the image on disk when the commit holds only its pointer', async () => {
		const repo = await createTempRepo();
		try {
			await repo.commit('logo.png', pointer('c'.repeat(64), 70), 'add logo via lfs');
			// What git-lfs would leave on disk: the real image, while HEAD keeps the pointer.
			await writeFile(path.join(repo.cwd, 'logo.png'), BLUE);
			const diff = await load(repo, { side: 'unstaged' });
			expect(diff.lfs?.before).toEqual({ oid: 'c'.repeat(64), size: 70 });
			expect(diff.image?.after?.bytes).toBe(BLUE.length);
		} finally {
			await repo.dispose();
		}
	});
});
