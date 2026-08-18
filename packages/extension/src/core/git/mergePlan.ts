/**
 * The one merge-options question, asked from two places — the commit context menu and a branch
 * chip dropped onto another — and the argv those answers become. One copy, so the two menus can
 * never drift apart on what "Squash" means.
 */
export const LIST_MERGE_OPTIONS = [
	{
		id: 'no-ff',
		label: 'No fast-forward',
		description: 'Always create a merge commit',
		picked: true,
	},
	{ id: 'squash', label: 'Squash commits', description: 'Combine into a single change' },
	{
		id: 'no-commit',
		label: 'No commit',
		description: 'Stage the merge without committing',
	},
];

/** Squash wins over no-ff: `--squash` never fast-forwards, so adding `--no-ff` would only error. */
export function mergeArgs(ref: string, listSelected: string[]): string[] {
	const args = ['merge', ref];
	if (listSelected.includes('squash')) args.push('--squash');
	else if (listSelected.includes('no-ff')) args.push('--no-ff');
	if (listSelected.includes('no-commit')) args.push('--no-commit');
	return args;
}
