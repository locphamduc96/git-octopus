import type { CommitPlanDraft, CommitPlanGroup } from '@git-octopus/shared';

/**
 * Pure editing operations over the plan the agent proposed. The dialog mutates a copy through
 * these, and only `buildExecuteGroups` decides what actually reaches git.
 */

export interface EditableGroup {
	listFiles: string[];
	subject: string;
	body: string;
}

export interface EditablePlan {
	listGroups: EditableGroup[];
	single: { subject: string; body: string };
}

export type CommitMode = 'single' | 'split';

export function toEditablePlan(draft: CommitPlanDraft): EditablePlan {
	return {
		listGroups: draft.listGroups.map((group) => ({
			listFiles: [...group.listFiles],
			subject: group.subject,
			body: group.body ?? '',
		})),
		single: { subject: draft.single.subject, body: draft.single.body ?? '' },
	};
}

export function listPlanFiles(plan: EditablePlan): string[] {
	return plan.listGroups.flatMap((group) => group.listFiles);
}

/**
 * Move one file into another group. Emptied groups are dropped — an empty commit can never be
 * executed, so it must not linger as an editable card either.
 */
export function moveFile(plan: EditablePlan, path: string, toIndex: number): EditablePlan {
	const target = plan.listGroups[toIndex];
	if (!target || target.listFiles.includes(path)) return plan;
	const listGroups = plan.listGroups
		.map((group) =>
			group === target
				? { ...group, listFiles: [...group.listFiles, path] }
				: { ...group, listFiles: group.listFiles.filter((file) => file !== path) }
		)
		.filter((group) => group.listFiles.length > 0);
	return { ...plan, listGroups };
}

/** Git convention: subject, blank line, body. */
function joinMessage(subject: string, body: string): string {
	const cleanSubject = subject.trim();
	const cleanBody = body.trim();
	return cleanBody === '' ? cleanSubject : `${cleanSubject}\n\n${cleanBody}`;
}

/**
 * What the host will be asked to run, or the reason it must not be. `single` mode folds every
 * file into one commit under the single message; `split` keeps the groups as edited.
 */
export function buildExecuteGroups(
	plan: EditablePlan,
	mode: CommitMode
): { listGroups: CommitPlanGroup[] } | { error: string } {
	if (mode === 'single') {
		if (plan.single.subject.trim() === '') return { error: 'The commit needs a subject.' };
		return {
			listGroups: [
				{ listFiles: listPlanFiles(plan), message: joinMessage(plan.single.subject, plan.single.body) },
			],
		};
	}
	for (const [index, group] of plan.listGroups.entries()) {
		if (group.subject.trim() === '') return { error: `Commit ${index + 1} needs a subject.` };
	}
	return {
		listGroups: plan.listGroups.map((group) => ({
			listFiles: [...group.listFiles],
			message: joinMessage(group.subject, group.body),
		})),
	};
}
