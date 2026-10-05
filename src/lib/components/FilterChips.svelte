<script lang="ts" generics="Value extends string">
	// One-of-several quick filters shown as buttons, each with a count, for example
	// "All 12 · Mine 4 · Needs a team 2". Needs JavaScript; without it the full list shows.
	let {
		label,
		options,
		value = $bindable()
	}: {
		label: string;
		options: { value: Value; label: string; count: number }[];
		value: Value;
	} = $props();
</script>

<div class="chips" role="group" aria-label={label}>
	{#each options as option (option.value)}
		<button
			type="button"
			class="chip"
			aria-pressed={value === option.value}
			onclick={() => (value = option.value)}
			>{option.label} <span class="chip-count">{option.count}</span></button
		>
	{/each}
</div>
