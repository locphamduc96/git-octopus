import type { DesktopViewMessage, WebviewToHost } from '@git-octopus/shared';
import { postToHost } from '../bridge';

/**
 * Say something to the desktop window rather than to the repository: a credential answer, a file to
 * save, a link to open. These ride the same channel as everything else, and the desktop host takes
 * them before the controller sees them, so they are not part of `WebviewToHost`; this is the one
 * place that bridges the two types.
 */
export function postToDesktop(message: DesktopViewMessage): void {
	postToHost(message as unknown as WebviewToHost);
}
