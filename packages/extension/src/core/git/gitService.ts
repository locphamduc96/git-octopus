import type { Commit } from '@git-octopus/shared';
import type { GitExecutor } from './GitExecutor.js';
import { LOG_FORMAT, parseLog } from './logParser.js';

/** Load up to `limit` commits across all refs, in graph (date) order. */
export async function getCommits(
	executor: GitExecutor,
	cwd: string,
	limit: number
): Promise<Commit[]> {
	const output = await executor.run(
		['log', `--pretty=format:${LOG_FORMAT}`, '--all', '--date-order', '-n', String(limit)],
		cwd
	);
	return parseLog(output);
}
