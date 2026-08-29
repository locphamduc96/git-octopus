import type { ErrorMessage, HostToWebview, WebviewToHost } from '@git-octopus/shared';

type MessageOf<K extends HostToWebview['type']> = Extract<HostToWebview, { type: K }>;
type AnyHandler = (message: never) => void;

/**
 * The requests whose failure means the graph itself is not there — the only ones allowed to
 * replace the whole view with an error screen.
 *
 * An error carrying any other source means a side query failed while the graph is still on screen,
 * and replacing the view would cost the user something that never broke.
 */
export const LIST_GRAPH_ERROR_SOURCES = [
	'loadCommits',
	'selectRepo',
] as const satisfies readonly WebviewToHost['type'][];

/** Whether an error from this request should take the graph down with it. */
export function ownsGraph(source: WebviewToHost['type'] | undefined): boolean {
	// `loadCommits` reports its own failures with no source at all, and those are exactly the ones
	// that mean there is no graph — so an absent source keeps the error screen.
	if (source === undefined) return true;
	return LIST_GRAPH_ERROR_SOURCES.some((candidate) => candidate === source);
}

/**
 * Which host messages a domain store owns instead of `App.svelte`.
 *
 * The ownership manifest, and the only place that answers "who reacts to this message". It exists
 * because `App.svelte` keeps a `default: never` arm for exhaustiveness: once a case leaves that
 * switch, the arm has to know the type left on purpose, otherwise a *new* protocol message would
 * land there and compile. Listing it here keeps the compile error for genuinely unhandled messages
 * while letting handled ones live in their own file.
 *
 * `hostRouter.test.ts` checks every entry actually has a handler registered, so a type listed here
 * and then forgotten fails the suite rather than going quietly unhandled at runtime.
 */
export const LIST_ROUTED_BY_STORE = [
	'identity',
	'workspaceIdentities',
	'branchInventory',
	'branchCleanupResult',
	'viewSettings',
	'fileDiff',
	'colorTheme',
	'agentInventory',
	'commitPlanProgress',
	'commitPlanResult',
	'commitPlanState',
	'commitPlanExecuted',
] as const satisfies readonly HostToWebview['type'][];

export type RoutedByStore = (typeof LIST_ROUTED_BY_STORE)[number];

const mapHandlers = new Map<HostToWebview['type'], AnyHandler[]>();
const listResetHooks: (() => void)[] = [];

/**
 * React to one host message type from wherever the state for it lives.
 *
 * Registration is by import: a store calls this at module scope, and `App.svelte` importing the
 * store is what puts it on the wire. Returns an unsubscribe, used by tests — stores register for
 * the life of the view and never need it.
 */
export function onHostType<K extends HostToWebview['type']>(
	type: K,
	handler: (message: MessageOf<K>) => void
): () => void {
	const listExisting = mapHandlers.get(type) ?? [];
	mapHandlers.set(type, [...listExisting, handler as AnyHandler]);
	return () => {
		const listCurrent = mapHandlers.get(type) ?? [];
		mapHandlers.set(
			type,
			listCurrent.filter((item) => item !== (handler as AnyHandler))
		);
	};
}

const listErrorObservers: ((message: ErrorMessage) => void)[] = [];

/**
 * Watch host errors without owning them.
 *
 * `error` stays `App.svelte`'s message — it decides between the error screen and a notice — but a
 * domain with something in flight has to hear about the failure too, or its spinner runs forever
 * waiting for a reply the host already gave up on. Observers are notified, never consulted: none of
 * them can stop the message reaching the switch.
 */
export function onHostError(observer: (message: ErrorMessage) => void): void {
	listErrorObservers.push(observer);
}

/** Tell every domain that a request failed, so anything waiting on it can stop waiting. */
export function notifyHostError(message: ErrorMessage): void {
	for (const observer of listErrorObservers) observer(message);
}

/** Hand a message to every handler registered for its type. True if at least one ran. */
export function dispatchHostMessage(message: HostToWebview): boolean {
	const listHandlers = mapHandlers.get(message.type) ?? [];
	for (const handler of listHandlers) {
		(handler as (value: HostToWebview) => void)(message);
	}
	return listHandlers.length > 0;
}

/**
 * Clear this domain's state when the view moves to another repository.
 *
 * The alternative is what `App.svelte` did: one more line in a reset block for every piece of state
 * anyone adds, in a file that has no idea what the state means. A domain that forgets to register
 * leaks its own state and nobody else's.
 */
export function onRepoReset(hook: () => void): void {
	listResetHooks.push(hook);
}

export function resetForRepo(): void {
	for (const hook of listResetHooks) hook();
}

/** Types with at least one handler right now. For tests and the registration check. */
export function listRoutedTypes(): HostToWebview['type'][] {
	return [...mapHandlers.entries()]
		.filter(([, listHandlers]) => listHandlers.length > 0)
		.map(([type]) => type);
}
