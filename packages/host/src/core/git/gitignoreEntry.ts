/** The pattern written for a repo-relative path: anchored, so it ignores that one file only. */
export function ignorePattern(repoRelativePath: string): string {
	return `/${repoRelativePath.replace(/^\/+/, '')}`;
}

/**
 * The `.gitignore` text with `repoRelativePath` added, or null when the file already lists it —
 * appending a duplicate is a silent no-op to git but noise in a file people read.
 *
 * A missing newline at the end is repaired first: without it the append lands on the same line as
 * the last pattern and quietly changes what that pattern matches.
 */
export function withIgnoreEntry(content: string, repoRelativePath: string): string | null {
	const pattern = ignorePattern(repoRelativePath);
	const listLines = content.split('\n').map((line) => line.trim());
	// A bare path counts too: `.gitignore` written by hand rarely carries the leading slash.
	if (listLines.includes(pattern) || listLines.includes(pattern.slice(1))) return null;
	if (content === '') return `${pattern}\n`;
	return content.endsWith('\n') ? `${content}${pattern}\n` : `${content}\n${pattern}\n`;
}
