<script lang="ts">
	import { page } from '$app/state';
	import { activate } from './activate.remote';
	const token = $derived(page.url.hash.slice(1));
</script>

<svelte:head><title>Verify your email · Lines</title></svelte:head>
<h1>Choose your password</h1>
<p>Use a unique passphrase with at least 15 characters. Your password manager can generate one.</p>
<form {...activate}>
	<label
		>Verification code<input
			{...activate.fields._token.as('text', token)}
			autocomplete="off"
			required
		/></label
	>
	<label
		>Password<input
			{...activate.fields._password.as('password')}
			autocomplete="new-password"
			minlength="15"
			maxlength="128"
			required
		/></label
	>
	{#each activate.fields.allIssues() ?? [] as issue, i (i)}<p class="issue" role="alert">
			{issue.message}
		</p>{/each}
	<button type="submit" disabled={!!activate.pending}>Verify email and create account</button>
</form>
<p class="muted">If the code is not filled in, paste it from your email.</p>
<p><a href="/signup">Request a new verification email</a></p>
