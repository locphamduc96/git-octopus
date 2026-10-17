<script lang="ts">
	import SelectField from './SelectField.svelte';

	let { onchange }: { onchange: (value: string) => void } = $props();
</script>

<SelectField
	aria-label="Pull strategy"
	value="config"
	onchange={(event) => onchange(event.currentTarget.value)}
>
	<option value="config">Follow git config</option>
	<option value="rebase">Rebase</option>
</SelectField>
