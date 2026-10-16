/**
 * Whether a path falls under one of the `.gitattributes` patterns LFS stores. Follows gitattributes
 * matching: a pattern without a slash matches the file name at any depth; one with a slash matches
 * the path from the repository root; `**` spans folders, `*` and `?` stay inside one.
 */
export function matchesLfs(path: string, listPatterns: string[]): boolean {
	return listPatterns.some((pattern) =>
		toRegExp(pattern).test(pattern.includes('/') ? path : baseName(path))
	);
}

function baseName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

const mapCompiled = new Map<string, RegExp>();

function toRegExp(pattern: string): RegExp {
	const cached = mapCompiled.get(pattern);
	if (cached) return cached;
	const body = pattern
		.replace(/^\//, '')
		.split(/(\*\*\/|\*\*|\*|\?)/)
		.map((part) => {
			if (part === '**/') return '(?:.*/)?';
			if (part === '**') return '.*';
			if (part === '*') return '[^/]*';
			if (part === '?') return '[^/]';
			return part.replace(/[.+^${}()|[\]\\]/g, '\\$&');
		})
		.join('');
	const compiled = new RegExp(`^${body}$`);
	mapCompiled.set(pattern, compiled);
	return compiled;
}
