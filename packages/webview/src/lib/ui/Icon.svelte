<script lang="ts">
	/**
	 * A VS Code Codicon. `name` is the icon id without the `codicon-` prefix
	 * (see https://microsoft.github.io/vscode-codicons/dist/codicon.html).
	 * Pass `label` only when the icon is the sole content of a control.
	 */
	let { name, label }: { name: string; label?: string } = $props();
</script>

<span
	class="codicon codicon-{name}"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
></span>
