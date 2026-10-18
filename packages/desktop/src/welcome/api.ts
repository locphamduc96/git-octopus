import type { ThemeKind } from '../ipc';

/** Main → Welcome page: everything it draws. */
export interface WelcomeState {
	/** Newest first; folders that no longer exist are already gone. */
	listRecent: string[];
	theme: ThemeKind;
}

/** Welcome page → main: what its preload exposes as `gitOctopusWelcome`, and nothing more. */
export interface WelcomeApi {
	onState(listener: (state: WelcomeState) => void): void;
	/** Ask for a folder in the native dialog and open it in a tab. */
	openDialog(): void;
	openRecent(folder: string): void;
	removeRecent(folder: string): void;
	/** A folder dropped on the page; its path is read here, since the page itself cannot see it. */
	openDropped(file: File): void;
}
