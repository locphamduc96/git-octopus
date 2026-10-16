import type { HostToWebview, LoadBlameMessage } from '@git-octopus/shared';
import { getBlame } from '../../core/git/blame.js';
import type { RepoContext } from './loadCommits.js';

/** Who last changed each line. Never throws: a file git cannot blame comes back as a notice. */
export async function loadBlame(
	ctx: RepoContext,
	message: LoadBlameMessage
): Promise<HostToWebview> {
	const empty = {
		type: 'blame' as const,
		key: message.key,
		path: message.path,
		listLines: [],
		listLineHashes: [],
		mapCommits: {},
	};
	if (!ctx.cwd) return { ...empty, notice: 'No Git repository is open in this workspace.' };
	try {
		const blame = await getBlame(ctx.executor, ctx.cwd, message.path, message.rev);
		if (blame.listLines.length === 0) return { ...empty, notice: 'This file is empty.' };
		return { type: 'blame', key: message.key, path: message.path, ...blame };
	} catch {
		// Mostly a file git does not track yet, or one that did not exist at that commit.
		return { ...empty, notice: 'There is no blame for this file here — git does not track it.' };
	}
}
