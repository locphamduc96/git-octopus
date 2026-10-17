import { readFileSync, writeFileSync } from 'node:fs';
import type { Rectangle } from 'electron';

/** What the app remembers between launches: where its window was, and what was open. */
export interface AppState {
	bounds?: Rectangle;
	/** Newest first. */
	listRecent: string[];
	/** The tabs open when the app last quit, in their order, reopened on the next launch. */
	listOpen: string[];
	/** Which of them was in front. */
	activeIndex?: number;
}

const MAX_RECENT = 10;

export function readAppState(file: string): AppState {
	try {
		const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppState>;
		return {
			bounds: parsed.bounds,
			listRecent: Array.isArray(parsed.listRecent) ? parsed.listRecent : [],
			listOpen: Array.isArray(parsed.listOpen) ? parsed.listOpen : [],
			activeIndex: typeof parsed.activeIndex === 'number' ? parsed.activeIndex : undefined,
		};
	} catch {
		return { listRecent: [], listOpen: [] };
	}
}

export function writeAppState(file: string, state: AppState): void {
	try {
		writeFileSync(file, `${JSON.stringify(state, null, '\t')}\n`);
	} catch {
		// Losing what was open last time costs a click; it must not stop the app.
	}
}

export function withRecent(listRecent: string[], folder: string): string[] {
	return [folder, ...listRecent.filter((item) => item !== folder)].slice(0, MAX_RECENT);
}
