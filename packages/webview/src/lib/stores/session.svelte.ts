/**
 * The two facts every domain needs and none of them owns: which repository the view is looking at,
 * and the transient line it reports back to the user.
 *
 * Kept here rather than passed down because a store cannot take props. Without it each domain store
 * would have to be handed an accessor by `App.svelte` at registration time — which puts the wiring
 * back in the file the stores exist to keep out of.
 *
 * Deliberately small. The rest of the graph state — rows, status, branches, selection — stays in
 * `App.svelte`; this is context, not a second home for everything.
 */

/** Null until the first `commits` reply says which repository the host settled on. */
let activeRepo = $state<string | null>(null);
let notice = $state<string | null>(null);
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

const NOTICE_MS = 4000;

export const session = {
	get activeRepo(): string | null {
		return activeRepo;
	},
	/** What the host's action messages want: the empty string stands for "no repository". */
	get repoPath(): string {
		return activeRepo ?? '';
	},
	get notice(): string | null {
		return notice;
	},
	setActiveRepo(path: string | null): void {
		activeRepo = path;
	},
	showNotice(message: string): void {
		notice = message;
		if (noticeTimer) clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = null), NOTICE_MS);
	},
};
