import { describe, expect, it } from 'vitest';
import type { GitExecutor } from './GitExecutor';
import { getFileDiff } from './gitService';

const UNTRACKED_DIFF = [
	'diff --git a/dev/null b/new.txt',
	'new file mode 100644',
	'--- /dev/null',
	'+++ b/new.txt',
	'@@ -0,0 +1,2 @@',
	'+a',
	'+b',
].join('\n');

/** Mirrors the real executor: `git diff --no-index` exits 1 when the files differ. */
function noIndexExecutor(): GitExecutor {
	return {
		run: (args, _cwd, listOkCodes) => {
			if (!args.includes('--no-index')) return Promise.resolve('');
			if (!listOkCodes?.includes(1)) return Promise.reject(new Error('git exited with code 1'));
			return Promise.resolve(UNTRACKED_DIFF);
		},
	};
}

describe('getFileDiff', () => {
	it('reads an untracked file despite the exit code --no-index uses to report a difference', async () => {
		const result = await getFileDiff(noIndexExecutor(), '/repo', {
			path: 'new.txt',
			untracked: true,
			context: 3,
		});
		expect(result.notice).toBeUndefined();
		expect(result.listHunks).toHaveLength(1);
		expect(result.listHunks[0].listLines.map((line) => line.text)).toEqual(['a', 'b']);
	});
});
