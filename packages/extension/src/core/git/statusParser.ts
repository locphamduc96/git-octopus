import type { FileChange, FileStatus, WorkingTreeStatus } from '@git-octopus/shared';

/** Arguments for `git status` in the machine-readable v2 form this parser expects. */
export const STATUS_ARGS = ['status', '--porcelain=v2', '-z', '--untracked-files=all'];

/**
 * Parse `git status --porcelain=v2 -z` output into staged/unstaged file lists.
 * Pure — no I/O. See git-status(1) "Porcelain Format Version 2".
 */
export function parseStatus(output: string): WorkingTreeStatus {
	const staged: FileChange[] = [];
	const unstaged: FileChange[] = [];
	const parts = output.split('\0');

	for (let i = 0; i < parts.length; i++) {
		const entry = parts[i];
		if (entry === '') continue;
		const type = entry[0];

		if (type === '?') {
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
			if (x !== '.') staged.push({ status: mapStatus(x), path, oldPath });
			if (y !== '.') unstaged.push({ status: mapStatus(y), path });
		} else if (type === 'u') {
			const fields = entry.split(' ');
			unstaged.push({ status: 'U', path: fields.slice(10).join(' ') });
		}
	}

	return { staged, unstaged };
}

function mapStatus(ch: string): FileStatus {
	return 'AMDRCTU'.includes(ch) ? (ch as FileStatus) : 'X';
}
