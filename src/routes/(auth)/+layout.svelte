<script lang="ts">
	import type { LayoutProps } from './$types';

	// Sign-in, signup, password reset and invitation pages: no app header.
	let { children }: LayoutProps = $props();
</script>

<main class="auth-shell">
	<a class="brand" href="/">Lines</a>
	{@render children()}
</main>
