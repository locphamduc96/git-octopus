import type {
	FileChange,
	FileStatus,
	SubmoduleChange,
	WorkingTreeStatus,
} from '@git-octopus/shared';

/** Arguments for `git status` in the machine-readable v2 form this parser expects. */
export const STATUS_ARGS = ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'];

/**
 * Where HEAD is, alongside what changed. HEAD has three shapes, not two, and the header lines
 * `--branch` adds name all of them: a branch with commits, a branch without any yet (`unborn`),
 * and no branch at all (`detached`). The last two are opposites — a name with no commit, and a
 * commit with no name — so a single "no branch" value cannot stand in for both.
 */
export interface StatusResult {
	working: WorkingTreeStatus;
	/** HEAD points at a branch that has no commits yet, reported as `# branch.oid (initial)`. */
	isUnborn: boolean;
	/** The checked-out branch, or null when HEAD is detached. Set even while unborn. */
	branch: string | null;
}

/** git's stand-in values in the two header lines this reads. */
const OID_UNBORN = '(initial)';
const HEAD_DETACHED = '(detached)';

/**
 * Parse `git status --porcelain=v2 -z --branch` output into HEAD's position and the staged and
 * unstaged file lists. Pure — no I/O. See git-status(1) "Porcelain Format Version 2".
 */
export function parseStatus(output: string): StatusResult {
	const staged: FileChange[] = [];
	const unstaged: FileChange[] = [];
	const parts = output.split('\0');
	let isUnborn = false;
	let branch: string | null = null;

	for (let i = 0; i < parts.length; i++) {
		const entry = parts[i];
		if (entry === '') continue;
		const type = entry[0];

		if (type === '#') {
			const [, key, ...rest] = entry.split(' ');
			const value = rest.join(' ');
			if (key === 'branch.oid') isUnborn = value === OID_UNBORN;
			if (key === 'branch.head') branch = value === HEAD_DETACHED ? null : value;
		} else if (type === '?') {
			unstaged.push({ status: '?', path: entry.slice(2) });
		} else if (type === '1' || type === '2') {
			const fields = entry.split(' ');
			const x = fields[1]?.[0] ?? '.';
			const y = fields[1]?.[1] ?? '.';
			let path: string;
			let oldPath: string | undefined;
			if (type === '2') {
				path = fields.slice(9).join(' ');
				oldPath = parts[i + 1];
				i++;
			} else {
				path = fields.slice(8).join(' ');
			}
			const submodule = parseSubmoduleField(fields[2]);
			const extra = submodule ? { submodule } : {};
			if (x !== '.') staged.push({ status: mapStatus(x), path, oldPath, ...extra });
			if (y !== '.') unstaged.push({ status: mapStatus(y), path, ...extra });
		} else if (type === 'u') {
			const fields = entry.split(' ');
			unstaged.push({ status: 'U', path: fields.slice(10).join(' ') });
		}
	}

	return { working: { staged, unstaged }, isUnborn, branch };
}

function mapStatus(ch: string): FileStatus {
	return 'AMDRCTU'.includes(ch) ? (ch as FileStatus) : 'X';
}

/**
 * The `<sub>` field: `N...` for a file, `S<c><m><u>` for a submodule — C when its checkout sits on
 * another commit than the one recorded, M for tracked edits inside it, U for untracked files.
 */
export function parseSubmoduleField(field: string | undefined): SubmoduleChange | null {
	if (!field?.startsWith('S') || field.length < 4) return null;
	return {
		commitChanged: field[1] === 'C',
		modified: field[2] === 'M',
		untracked: field[3] === 'U',
	};
}
