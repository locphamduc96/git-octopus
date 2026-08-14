import type { FileIconTheme } from '@git-octopus/shared';

/**
 * The user's file-icon theme, sent by the host. Kept in a store rather than passed down, since every
 * file row in every panel wants it and none of them own it.
 */
let theme = $state<FileIconTheme | null>(null);

export function setFileIconTheme(next: FileIconTheme | null): void {
	theme = next;
}

export function fileIconTheme(): FileIconTheme | null {
	return theme;
}
