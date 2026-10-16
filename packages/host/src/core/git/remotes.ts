import type { RemoteInfo } from '@git-octopus/shared';
import type { GitExecutor } from './GitExecutor.js';

/**
 * Parse `git remote -v`: two lines per remote, `name<TAB>url (fetch)` and `name<TAB>url (push)`.
 * The push URL is kept only when it differs — that is the case worth showing.
 */
export function parseRemotes(output: string): RemoteInfo[] {
	const mapRemotes = new Map<string, { fetchUrl?: string; pushUrl?: string }>();
	for (const line of output.split('\n')) {
		const match = /^(\S+)\t(.+) \((fetch|push)\)$/.exec(line.trim());
		if (!match) continue;
		const [, name, url, kind] = match;
		const entry = mapRemotes.get(name) ?? {};
		if (kind === 'fetch') entry.fetchUrl = url;
		else entry.pushUrl = url;
		mapRemotes.set(name, entry);
	}
	return [...mapRemotes].map(([name, entry]) => {
		const fetchUrl = entry.fetchUrl ?? entry.pushUrl ?? '';
		return entry.pushUrl && entry.pushUrl !== fetchUrl
			? { name, fetchUrl, pushUrl: entry.pushUrl }
			: { name, fetchUrl };
	});
}

export async function getRemotes(executor: GitExecutor, cwd: string): Promise<RemoteInfo[]> {
	return parseRemotes(await executor.run(['remote', '-v'], cwd));
}
