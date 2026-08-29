<script lang="ts">
	/**
	 * Test-only stand-in for `SettingsWidget`'s wiring, imported by nothing but the component test.
	 *
	 * It reproduces the two facts the picker's draft contract depends on: the host answers every
	 * save by replacing the whole settings object, and the picker's `value` arrives through a
	 * `$derived` of its own — so a broadcast that lands on the value already held notifies nobody.
	 */
	import PresetPicker, { type PresetOption } from './PresetPicker.svelte';

	let {
		listOptions,
		initial,
		onsave,
	}: {
		listOptions: PresetOption[];
		initial: string;
		onsave: (value: string) => void;
	} = $props();

	// The prop seeds the state once, by design — later values come in through broadcast().
	// svelte-ignore state_referenced_locally
	let settings = $state({ model: initial });
	const value = $derived(settings.model);

	/** What a host settings broadcast does: a brand-new object, whatever the values. */
	export function broadcast(model: string): void {
		settings = { model };
	}
</script>

<PresetPicker label="Model" {listOptions} {value} customPlaceholder="model id" {onsave} />
