import type { HostToWebview, WebviewToHost } from '@git-octopus/shared';

export interface RouterContext {
	version: string;
}

/**
 * Pure message router: maps an inbound webview message to an optional reply.
 * Kept free of `vscode` imports so it can be unit-tested in isolation.
 * Real use-cases (load commits, checkout, …) plug in here in Feature 002.
 */
export function routeMessage(
	message: WebviewToHost,
	ctx: RouterContext
): HostToWebview | undefined {
	switch (message.type) {
		case 'ready':
			return { type: 'pong', nonce: 0, version: ctx.version };
		case 'ping':
			return { type: 'pong', nonce: message.nonce, version: ctx.version };
		default:
			return undefined;
	}
}
