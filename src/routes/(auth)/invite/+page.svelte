<script lang="ts">
	import { page } from '$app/state';
	import { getIdentity } from '#lib/remotes/auth.remote.js';
	import { acceptInvitation } from './invite.remote';
	const user = getIdentity();
	const token = $derived(page.url.hash.slice(1));
</script>

<svelte:head><title>Join your firm · Lines</title></svelte:head>
<h1>Join your firm</h1>
{#if await user}
	<p>Accept using the email address your firm invited.</p>
	<form {...acceptInvitation}>
		<label
			>Invitation code<input
				{...acceptInvitation.fields._token.as('text', token)}
				autocomplete="off"
				required
			/></label
		>
		{#each acceptInvitation.fields.allIssues() ?? [] as issue, i (i)}<p class="issue" role="alert">
				{issue.message}
			</p>{/each}
		<button type="submit" disabled={!!acceptInvitation.pending}>Accept invitation</button>
	</form>
	<p><a href="/account">Set up MFA if your account requires it</a></p>
{:else}
	<p>
		<a href="/signup">Create an account</a> or <a href="/login">sign in</a> using the invited email, then
		reopen this invitation.
	</p>
{/if}
