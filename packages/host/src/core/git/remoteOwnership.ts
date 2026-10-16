/**
 * Which configured remote a `refs/remotes/...` path belongs to.
 *
 * Usually one, and obvious. But remote names may contain slashes, so two of them can lay claim to
 * the same ref path and git will not settle it either: with remotes `team` and `team/origin`, both
 * default refspecs write `refs/remotes/team/origin/main` — one for `team/origin`'s `main`, one for
 * `team`'s branch literally named `origin/main` — and whichever fetched last owns the ref.
 *
 * There is no answer to recover, so nothing here invents one. Callers that only draw a label may
 * take the longest match; callers that are about to run a command against a remote must refuse.
 */
export function listCandidateRemotes(refPath: string, listRemotes: string[]): string[] {
	const prefix = 'refs/remotes/';
	if (!refPath.startsWith(prefix)) return [];
	const rest = refPath.slice(prefix.length);
	return listRemotes
		.filter((remote) => rest.startsWith(`${remote}/`) && rest.length > remote.length + 1)
		.sort((a, b) => b.length - a.length);
}

/**
 * Whether acting on this ref would mean picking a remote at random.
 *
 * Note this asks about the *ref path*, not about the remote the view happened to name: the view's
 * split is a guess made from the same ambiguous string, so trusting it would launder the guess.
 */
export function remoteIsAmbiguous(refPath: string, listRemotes: string[]): boolean {
	return listCandidateRemotes(refPath, listRemotes).length > 1;
}
