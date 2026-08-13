import { createHash } from 'node:crypto';

/**
 * Gravatar URL for an email address. Gravatar identifies users by the MD5 of the lowercased,
 * trimmed address; `d=retro` renders a generated avatar when the address has no Gravatar account.
 */
export function gravatarUrl(email: string, size = 32): string {
	const hash = createHash('md5').update(email.trim().toLowerCase()).digest('hex');
	return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=retro`;
}
