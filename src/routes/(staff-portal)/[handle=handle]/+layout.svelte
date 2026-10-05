<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';
	import { getWorkspace } from '#lib/remotes/workspace.remote.js';
	import { refreshOn } from '#lib/live-updates.svelte.js';
	let { children }: LayoutProps = $props();

	// Every firm page shows getWorkspace; a membership change can change the user's role.
	refreshOn(
		(change) => change.action.startsWith('membership.'),
		() => getWorkspace(page.params.handle ?? '').refresh()
	);
</script>

<main class="workspace">
	{@render children()}
</main>
