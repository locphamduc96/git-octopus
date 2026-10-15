import type { GraphFilters, HiddenRefs } from '@git-octopus/shared';
import type { ViewSettings } from './viewSettings';

export const NO_HIDDEN_REFS: HiddenRefs = { listBranches: [], listRemotes: [], listTags: [] };

/** How many refs are hidden, all namespaces together. */
export function hiddenCount(hidden: HiddenRefs): number {
	return hidden.listBranches.length + hidden.listRemotes.length + hidden.listTags.length;
}

/**
 * The filter payload sent with every loadCommits — settings the host walk depends on.
 * `listSolo` is the view's session-only "show only these branches" choice, not a saved setting;
 * `hidden` is kept per repository by the view.
 */
export function buildHostFilters(
	settings: ViewSettings,
	listSolo: string[] = [],
	hidden: HiddenRefs = NO_HIDDEN_REFS
): GraphFilters {
	return {
		branch: listSolo[0] ?? null,
		listSoloRefs: listSolo,
		hiddenRefs: hidden,
		showRemoteBranches: settings.showRemoteBranches,
		fetchAvatars: settings.fetchAvatars,
		commitOrder: settings.commitOrder,
		showTags: settings.showTags,
		showStashes: settings.showStashes,
		showUncommitted: settings.showUncommitted,
	};
}

/**
 * Whether a commits reply was walked with what this view is asking for now. Loads run
 * concurrently on the host, so a reply carrying old filters — or less history than the view
 * has — can land after the one that superseded it, and must not repaint the graph.
 *
 * `wanted` must be built from the settings as they stand when the reply arrives, not captured
 * when the request went out — the whole point is comparing the reply against *now*.
 */
export function commitsReplyMatches(
	reply: { limit?: number; filters?: GraphFilters },
	wanted: GraphFilters,
	graphLimit: number
): boolean {
	if (reply.limit !== undefined && reply.limit < graphLimit) return false;
	const echoed = reply.filters;
	if (!echoed) return true;
	return (
		(echoed.branch ?? null) === (wanted.branch ?? null) &&
		(echoed.listSoloRefs ?? []).join('\0') === (wanted.listSoloRefs ?? []).join('\0') &&
		JSON.stringify(echoed.hiddenRefs ?? NO_HIDDEN_REFS) ===
			JSON.stringify(wanted.hiddenRefs ?? NO_HIDDEN_REFS) &&
		echoed.showRemoteBranches === wanted.showRemoteBranches &&
		(echoed.fetchAvatars ?? false) === wanted.fetchAvatars &&
		(echoed.commitOrder ?? 'date') === wanted.commitOrder &&
		(echoed.showTags ?? true) === wanted.showTags &&
		(echoed.showStashes ?? true) === wanted.showStashes &&
		(echoed.showUncommitted ?? true) === wanted.showUncommitted
	);
}

/** What a loadCommits was asked with, comparable as one string against saved settings. */
export function loadSignature(commitLimit: number, filters: GraphFilters): string {
	return JSON.stringify({ base: commitLimit, filters });
}
