import type {
	RefPanelData,
	RefPanelRef,
	RefPanelRemoteRef,
	RefPanelStash,
} from '@git-octopus/shared';
import type { GitExecutor } from './GitExecutor.js';

const PREFIX_HEADS = 'refs/heads/';
const PREFIX_REMOTES = 'refs/remotes/';
const PREFIX_TAGS = 'refs/tags/';

/**
 * Parse `git for-each-ref --format=%(refname)%00%(objectname)%00%(*objectname)%00%(HEAD)`: one
 * record per line, NUL between fields (a ref name can hold neither). Full names rather than
 * `:short` ones, so a branch and a tag sharing a name stay apart and `<remote>/HEAD` is spotted by
 * its path, whatever git version prints it.
 */
export function parseRefs(
	output: string,
	listRemoteNames: string[] = []
): Omit<RefPanelData, 'listStashes'> {
	const listLongestFirst = [...listRemoteNames].sort((a, b) => b.length - a.length);
	const listLocal: RefPanelRef[] = [];
	const listRemote: RefPanelRemoteRef[] = [];
	const listTags: RefPanelRef[] = [];
	let current: string | null = null;
	for (const line of output.split('\n')) {
		if (line === '') continue;
		const [refname = '', objectName = '', peeled = '', head = ''] = line.split('\0');
		if (refname.startsWith(PREFIX_HEADS)) {
			const name = refname.slice(PREFIX_HEADS.length);
			listLocal.push({ name, hash: objectName });
			if (head === '*') current = name;
		} else if (refname.startsWith(PREFIX_REMOTES)) {
			const name = refname.slice(PREFIX_REMOTES.length);
			const known = listLongestFirst.find((candidate) => name.startsWith(`${candidate}/`));
			const slash = known === undefined ? name.indexOf('/') : known.length;
			if (slash <= 0 || name.slice(slash + 1) === 'HEAD') continue;
			listRemote.push({ name, hash: objectName, remote: name.slice(0, slash) });
		} else if (refname.startsWith(PREFIX_TAGS)) {
			listTags.push({ name: refname.slice(PREFIX_TAGS.length), hash: peeled || objectName });
		}
	}
	return { listLocal, listRemote, listTags, current };
}

/** Parse `git remote`: one name per line. */
export function parseRemoteNames(output: string): string[] {
	return output.split('\n').filter((line) => line !== '');
}

/** Parse `git stash list --format=%gd%x00%H%x00%s`. */
export function parseStashes(output: string): RefPanelStash[] {
	return output
		.split('\n')
		.filter((line) => line !== '')
		.map((line) => {
			const [selector = '', hash = '', ...listMessage] = line.split('\0');
			return { selector, hash, message: listMessage.join('\0') };
		})
		.filter((stash) => stash.selector !== '');
}

/** Every ref the side panel lists, from one `for-each-ref` and one `stash list`. */
export async function getRefPanelData(executor: GitExecutor, cwd: string): Promise<RefPanelData> {
	const [refsOutput, stashOutput, remoteOutput] = await Promise.all([
		executor
			.run(
				[
					'for-each-ref',
					'--format=%(refname)%00%(objectname)%00%(*objectname)%00%(HEAD)',
					PREFIX_HEADS,
					PREFIX_REMOTES,
					PREFIX_TAGS,
				],
				cwd
			)
			.catch(() => ''),
		executor.run(['stash', 'list', '--format=%gd%x00%H%x00%s'], cwd).catch(() => ''),
		executor.run(['remote'], cwd).catch(() => ''),
	]);
	return {
		...parseRefs(refsOutput, parseRemoteNames(remoteOutput)),
		listStashes: parseStashes(stashOutput),
	};
}
