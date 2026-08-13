/**
 * Host ↔ webview message protocol.
 * Scaffold stage: only a ping/pong handshake to prove the bridge works.
 * The real request/response/event protocol lands in Feature 002.
 */

export interface PingMessage {
	type: 'ping';
	nonce: number;
}

export interface ReadyMessage {
	type: 'ready';
}

/** Messages sent from the webview to the extension host. */
export type WebviewToHost = PingMessage | ReadyMessage;

export interface PongMessage {
	type: 'pong';
	nonce: number;
	/** Extension version, so the webview can show it in the handshake. */
	version: string;
}

/** Messages sent from the extension host to the webview. */
export type HostToWebview = PongMessage;
