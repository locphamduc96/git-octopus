<script lang="ts">
	/**
	 * The three glyphs a ref chip can carry, drawn as inline SVG rather than from the codicon font:
	 * at chip size the font glyphs land off their pixel grid and read heavier than the chip around
	 * them.
	 *
	 * Paths are from GitHub Octicons (MIT, © GitHub Inc.) — see THIRD-PARTY-NOTICES.md in the
	 * extension package for the attribution and licence text.
	 */
	const mapPaths: Record<string, string> = {
		check:
			'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z',
		'device-desktop':
			'M14.25 1c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 14.25 12h-3.727c.099 1.041.52 1.872 1.292 2.757A.752.752 0 0 1 11.25 16h-6.5a.75.75 0 0 1-.565-1.243c.772-.885 1.192-1.716 1.292-2.757H1.75A1.75 1.75 0 0 1 0 10.25v-7.5C0 1.784.784 1 1.75 1ZM1.75 2.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25ZM9.018 12H6.982a5.72 5.72 0 0 1-.765 2.5h3.566a5.72 5.72 0 0 1-.765-2.5Z',
		cloud:
			'M2 7.25A5.225 5.225 0 0 1 7.25 2a5.222 5.222 0 0 1 4.767 3.029A4.472 4.472 0 0 1 16 9.5c0 2.505-1.995 4.5-4.5 4.5h-8A3.474 3.474 0 0 1 0 10.5c0-1.41.809-2.614 2.001-3.17Zm1.54.482a.75.75 0 0 1-.556.832c-.86.22-1.484.987-1.484 1.936 0 1.124.876 2 2 2h8c1.676 0 3-1.324 3-3s-1.324-3-3-3a.75.75 0 0 1-.709-.504A3.72 3.72 0 0 0 7.25 3.5C5.16 3.5 3.5 5.16 3.5 7.25c.002.146.014.292.035.436l.004.036.001.008Z',
	};

	let { name, size = 13 }: { name: keyof typeof mapPaths | string; size?: number } = $props();
</script>

<svg
	class="ref-icon"
	width={size}
	height={size}
	viewBox="0 0 16 16"
	fill="currentColor"
	aria-hidden="true"
>
	<path d={mapPaths[name]} />
</svg>

<style>
	.ref-icon {
		flex: none;
		display: block;
	}
</style>
