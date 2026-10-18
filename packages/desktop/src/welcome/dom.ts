import type { ThemeKind } from '../ipc';

export function applyTheme(theme: ThemeKind): void {
	document.documentElement.dataset.theme = theme;
}

/** A drag that carries files from outside the page, not text or a link being moved around. */
export function carriesFiles(event: DragEvent): boolean {
	return event.dataTransfer?.types.includes('Files') ?? false;
}

export function droppedFiles(event: DragEvent): File[] {
	return Array.from(event.dataTransfer?.files ?? []);
}
