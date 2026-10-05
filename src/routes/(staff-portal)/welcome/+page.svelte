<script lang="ts">
	import { getIdentity } from '#lib/remotes/auth.remote.js';
	const user = $derived(await getIdentity());
</script>

<svelte:head><title>Welcome</title></svelte:head>

<main class="workspace narrow">
	<h1>Welcome{user ? `, ${user.name.split(' ')[0]}` : ''}</h1>
	<p>You're not part of a firm yet.</p>
	<section class="panel">
		<h2>Joining your firm?</h2>
		<p class="muted">
			Ask an owner or admin at your firm to invite this email address. The invitation email brings
			you straight in.
		</p>
	</section>
	<section class="panel">
		<h2>Setting up your firm?</h2>
		<p class="muted">Create a workspace for your firm, then invite your team.</p>
		<a class="button" href="/new-firm">Create a firm</a>
	</section>
</main>
