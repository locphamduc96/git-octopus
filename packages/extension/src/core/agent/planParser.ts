import type { CommitPlanDraft } from '@git-octopus/shared';

/**
 * Turn the agent's answer into a plan the UI can trust.
 *
 * An LLM's JSON is a draft, not a contract: it may fence it in markdown, drop a file, invent one,
 * or split a `.meta` from its owner. Everything the execute step depends on is therefore repaired
 * or rejected here, so the dialog only ever shows a plan that covers exactly the real changes.
 */

export type ParseResult = { plan: CommitPlanDraft; error?: never } | { plan?: never; error: string };

interface RawGroup {
	files?: unknown;
	subject?: unknown;
	body?: unknown;
}

function normalizePath(path: string): string {
	return path.trim().replace(/^\.\//, '');
}

/** Pull the JSON object out of an answer that may carry fences or stray prose around it. */
function extractJson(raw: string): string | null {
	const unfenced = raw.replace(/```[a-z]*\n?/gi, '');
	const start = unfenced.indexOf('{');
	const end = unfenced.lastIndexOf('}');
	if (start === -1 || end <= start) return null;
	return unfenced.slice(start, end + 1);
}

function asMessage(value: RawGroup): { subject: string; body?: string } | null {
	if (typeof value.subject !== 'string' || value.subject.trim() === '') return null;
	const subject = value.subject.trim();
	const body = typeof value.body === 'string' && value.body.trim() !== '' ? value.body.trim() : undefined;
	return { subject, body };
}

export function parseCommitPlan(raw: string, listAllPaths: string[]): ParseResult {
	const json = extractJson(raw);
	if (!json) return { error: 'The agent did not answer with JSON.' };

	let parsed: { groups?: unknown; single?: unknown };
	try {
		parsed = JSON.parse(json) as { groups?: unknown; single?: unknown };
	} catch {
		return { error: 'The agent answered with JSON that does not parse.' };
	}

	const setKnown = new Set(listAllPaths.map(normalizePath));
	const listRawGroups = Array.isArray(parsed.groups) ? (parsed.groups as RawGroup[]) : [];

	const listGroups: { listFiles: string[]; subject: string; body?: string }[] = [];
	const setSeen = new Set<string>();
	for (const rawGroup of listRawGroups) {
		if (rawGroup === null || typeof rawGroup !== 'object') continue;
		const message = asMessage(rawGroup);
		if (!message) continue;
		const listFiles = (Array.isArray(rawGroup.files) ? rawGroup.files : [])
			.filter((file): file is string => typeof file === 'string')
			.map(normalizePath)
			// Invented paths are dropped; a file the agent named twice stays where it first appeared.
			.filter((file) => setKnown.has(file) && !setSeen.has(file));
		for (const file of listFiles) setSeen.add(file);
		if (listFiles.length > 0) listGroups.push({ listFiles, ...message });
	}

	const single = asMessage((parsed.single ?? {}) as RawGroup) ?? listGroups[0];
	if (!single) return { error: 'The agent returned no usable commit message.' };

	if (listGroups.length === 0) {
		return { plan: { listGroups: [{ listFiles: [...setKnown], ...single }], single } };
	}

	// A file the agent forgot still has to be committed somewhere; the last group is the
	// least-specific place ("rest of the changes") without inventing a message of our own.
	const listMissing = [...setKnown].filter((path) => !setSeen.has(path));
	if (listMissing.length > 0) {
		listGroups[listGroups.length - 1].listFiles.push(...listMissing);
	}

	pairMetaWithOwner(listGroups);
	return { plan: { listGroups, single } };
}

/**
 * A `.meta` belongs to the commit that touches its owner file — an editor convention (Cocos,
 * Unity) the plan must never violate, so it is enforced here rather than asked of the agent.
 */
function pairMetaWithOwner(listGroups: { listFiles: string[] }[]): void {
	const mapGroupByFile = new Map<string, number>();
	listGroups.forEach((group, index) => {
		for (const file of group.listFiles) mapGroupByFile.set(file, index);
	});
	for (const [file, fromIndex] of mapGroupByFile) {
		if (!file.endsWith('.meta')) continue;
		const ownerIndex = mapGroupByFile.get(file.slice(0, -'.meta'.length));
		if (ownerIndex === undefined || ownerIndex === fromIndex) continue;
		listGroups[fromIndex].listFiles = listGroups[fromIndex].listFiles.filter(
			(item) => item !== file
		);
		listGroups[ownerIndex].listFiles.push(file);
	}
	// Moving metas can drain a group; an empty commit must never reach `git`.
	for (let i = listGroups.length - 1; i >= 0; i--) {
		if (listGroups[i].listFiles.length === 0) listGroups.splice(i, 1);
	}
}
