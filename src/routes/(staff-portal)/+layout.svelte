<script lang="ts">
	import type { LayoutProps } from './$types';
	import AppHeader from '#lib/components/AppHeader.svelte';

	// Pages for signed-in firm staff. Showing or hiding pages here is only for
	// navigation; every remote function still checks access itself.
	let { children }: LayoutProps = $props();
</script>

<AppHeader />
{@render children()}
