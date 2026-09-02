/**
 * What jsdom does not implement but a mounted component expects to exist.
 *
 * `ResizeObserver` is the graph's way of learning its own width, and jsdom ships none — a component
 * that observes anything throws on mount rather than failing an assertion, which reads as a broken
 * test rather than a missing browser API. A no-op observer is honest here: jsdom lays nothing out,
 * so a real one would only ever report zeroes.
 */
class NoopResizeObserver implements ResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
	globalThis.ResizeObserver = NoopResizeObserver;
}
