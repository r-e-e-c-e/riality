<script lang="ts">
	import ErrorDetails from '#lib/components/ErrorDetails.svelte';
</script>

<!-- Errors outside the staff portal, such as an unknown URL while signed out. -->
<main class="auth-shell">
	<a class="brand" href="/">Lines</a>
	<ErrorDetails />
</main>
