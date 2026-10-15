import { describe, expect, it } from 'vitest';
import { GitProcessExecutor } from '../../adapters/process/gitProcessExecutor.js';
import { createTempRepo } from '../../test/tempRepo.js';
import { getCommitStats, parseCommitStatsLog, parseShortstat } from './commitStats.js';

describe('parseShortstat', () => {
	it('reads all three counts, singular or plural', () => {
		expect(parseShortstat(' 2 files changed, 27 insertions(+), 11 deletions(-)')).toEqual({
			files: 2,
			insertions: 27,
			deletions: 11,
		});
		expect(parseShortstat(' 1 file changed, 1 insertion(+), 1 deletion(-)')).toEqual({
			files: 1,
			insertions: 1,
			deletions: 1,
		});
	});

	it('reads a count git left out as zero', () => {
		expect(parseShortstat(' 3 files changed, 409 insertions(+)')).toEqual({
			files: 3,
			insertions: 409,
			deletions: 0,
		});
		expect(parseShortstat(' 1 file changed, 4 deletions(-)')).toEqual({
			files: 1,
			insertions: 0,
			deletions: 4,
		});
		expect(parseShortstat('')).toEqual({ files: 0, insertions: 0, deletions: 0 });
	});
});

describe('parseCommitStatsLog', () => {
	it('splits the records, parents and stats — an empty commit carries no stat line', () => {
		const output =
			'\0aaa\0ppp\n\n 1 file changed, 2 insertions(+)\n' +
			'\0bbb\0p1 p2\n' +
			'\0ccc\0\n\n 2 files changed, 3 deletions(-)\n';
		expect(parseCommitStatsLog(output)).toEqual([
			{ hash: 'aaa', listParents: ['ppp'], stat: { files: 1, insertions: 2, deletions: 0 } },
			{ hash: 'bbb', listParents: ['p1', 'p2'], stat: { files: 0, insertions: 0, deletions: 0 } },
			{ hash: 'ccc', listParents: [], stat: { files: 2, insertions: 0, deletions: 3 } },
		]);
	});
});

describe('getCommitStats against a real repository', () => {
	it('measures plain and root commits, and a merge against its first parent', async () => {
		const repo = await createTempRepo();
		try {
			const root = await repo.commit('a.txt', 'a\nb\n', 'root');
			await repo.git('checkout', '-b', 'side');
			await repo.commit('s.txt', 's1\ns2\ns3\n', 'side work');
			await repo.git('checkout', 'main');
			const plain = await repo.commit('a.txt', 'a\nB\n', 'edit');
			await repo.git('merge', '--no-ff', '-m', 'merge side', 'side');
			const merge = (await repo.git('rev-parse', 'HEAD')).trim();

			const listStats = await getCommitStats(new GitProcessExecutor(), repo.cwd, [
				merge,
				plain,
				root,
				'--not-a-hash',
			]);
			const mapByHash = new Map(listStats.map((stat) => [stat.hash, stat]));
			expect(listStats).toHaveLength(3);
			expect(mapByHash.get(root)).toMatchObject({ files: 1, insertions: 2, deletions: 0 });
			expect(mapByHash.get(plain)).toMatchObject({ files: 1, insertions: 1, deletions: 1 });
			// What the merge brought into main: side's file, not main's own edit.
			expect(mapByHash.get(merge)).toMatchObject({ files: 1, insertions: 3, deletions: 0 });
		} finally {
			await repo.dispose();
		}
	});
});
