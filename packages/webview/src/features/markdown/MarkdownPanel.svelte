<script module lang="ts">
	import MarkdownIt from 'markdown-it';

	const SAFE_PROTOCOL = 'https:';

	function isOpenable(href: string): boolean {
		try {
			return new URL(href).protocol === SAFE_PROTOCOL;
		} catch {
			return false;
		}
	}

	const markdown = new MarkdownIt({ html: false, linkify: false });

	// Raw HTML is already off; this closes the other ways a document can reach out. A link that is
	// not https becomes an inert span (same text, nothing to click), and an image is shown as its alt
	// text so the panel never fetches anything on its own.
	markdown.core.ruler.push('inertLinks', (state) => {
		for (const block of state.tokens) {
			if (block.type !== 'inline' || block.children === null) continue;
			let inertDepth = 0;
			for (const token of block.children) {
				if (token.type === 'link_open') {
					const href = String(token.attrGet('href') ?? '');
					if (!isOpenable(href)) {
						inertDepth += 1;
						token.tag = 'span';
						token.attrs = [['class', 'inert-link']];
					}
				} else if (token.type === 'link_close' && inertDepth > 0) {
					inertDepth -= 1;
					token.tag = 'span';
				}
			}
		}
	});

	markdown.renderer.rules.image = (listTokens, index) => {
		const alt = listTokens[index].content;
		return markdown.utils.escapeHtml(alt);
	};
</script>

<script lang="ts">
	let {
		title,
		content,
		oncopy,
		onsave,
		onopenlink,
	}: {
		title: string;
		/** Markdown source. Shown rendered; Copy and Save as… hand it back unchanged. */
		content: string;
		oncopy: (markdown: string) => void;
		onsave: (markdown: string) => void;
		/** Called with an `https:` URL the user clicked; the panel never navigates by itself. */
		onopenlink: (url: string) => void;
	} = $props();

	const html = $derived(markdown.render(content));

	function guardLinks(node: HTMLElement) {
		function find(event: Event): HTMLAnchorElement | null {
			const target = event.target;
			return target instanceof Element ? target.closest('a') : null;
		}
		function onclick(event: MouseEvent) {
			const anchor = find(event);
			if (anchor === null) return;
			event.preventDefault();
			const href = anchor.getAttribute('href') ?? '';
			if (isOpenable(href)) onopenlink(href);
		}
		function onauxclick(event: MouseEvent) {
			if (find(event) !== null) event.preventDefault();
		}
		node.addEventListener('click', onclick);
		node.addEventListener('auxclick', onauxclick);
		return {
			destroy() {
				node.removeEventListener('click', onclick);
				node.removeEventListener('auxclick', onauxclick);
			},
		};
	}
</script>

<section class="panel">
	<header>
		<h2>{title}</h2>
		<div class="actions">
			<button class="secondary" onclick={() => oncopy(content)}>Copy</button>
			<button class="secondary" onclick={() => onsave(content)}>Save as…</button>
		</div>
	</header>
	<!-- The renderer runs with raw HTML off and escapes all text, so this string holds only tags markdown-it itself emitted. -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	<div class="body" use:guardLinks>{@html html}</div>
</section>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: var(--gg-bg);
		color: var(--gg-fg);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--gg-space-3);
		padding: var(--gg-space-2) var(--gg-space-4);
		background: var(--gg-bg-raised);
	}
	h2 {
		margin: 0;
		font-size: var(--gg-text-md);
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.actions {
		display: flex;
		gap: var(--gg-space-2);
		flex: none;
	}
	button {
		display: inline-flex;
		align-items: center;
		height: var(--gg-hit);
		padding: 0 var(--gg-space-3);
		border: none;
		border-radius: var(--gg-radius);
		font: inherit;
		cursor: pointer;
	}
	.secondary {
		background: var(--gg-btn2-bg);
		color: var(--gg-btn2-fg);
	}
	.secondary:hover {
		background: var(--gg-btn2-hover);
	}
	.body {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: var(--gg-space-3) var(--gg-space-4);
		line-height: 1.55;
		user-select: text;
	}
	.body :global(h1),
	.body :global(h2),
	.body :global(h3),
	.body :global(h4) {
		margin: 1em 0 0.4em;
		line-height: 1.25;
	}
	.body :global(h1) {
		font-size: var(--gg-text-lg);
	}
	.body :global(h2),
	.body :global(h3),
	.body :global(h4) {
		font-size: var(--gg-text-md);
	}
	.body :global(p),
	.body :global(ul),
	.body :global(ol),
	.body :global(blockquote) {
		margin: 0.5em 0;
	}
	.body :global(ul),
	.body :global(ol) {
		padding-left: 1.5em;
	}
	.body :global(blockquote) {
		padding: 0 var(--gg-space-3);
		background: var(--gg-bg-raised);
		color: var(--gg-fg-muted);
	}
	.body :global(code) {
		font-family: var(--gg-font-mono);
		font-size: var(--gg-text-mono);
		padding: 0 var(--gg-space-1);
		background: var(--gg-bg-raised);
		border-radius: var(--gg-radius-sm);
	}
	.body :global(pre) {
		margin: 0.5em 0;
		padding: var(--gg-space-3);
		overflow: auto;
		background: var(--gg-bg-raised);
		border-radius: var(--gg-radius);
	}
	.body :global(pre code) {
		padding: 0;
		background: none;
	}
	.body :global(a) {
		color: var(--gg-accent);
		cursor: pointer;
	}
	.body :global(.inert-link) {
		color: inherit;
		cursor: text;
	}
</style>
