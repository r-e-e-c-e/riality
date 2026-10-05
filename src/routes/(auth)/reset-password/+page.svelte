<script lang="ts">
	import { page } from '$app/state';
	import { resetPassword } from './reset-password.remote';
	const token = $derived(page.url.hash.slice(1));
</script>

<svelte:head><title>Choose a new password · Lines</title></svelte:head>
<h1>Choose a new password</h1>
<p>Use at least 15 characters. Updating your password signs out every existing session.</p>
<form {...resetPassword}>
	<label
		>Reset code<input
			{...resetPassword.fields._token.as('text', token)}
			autocomplete="off"
			required
		/></label
	>
	<label
		>New password<input
			{...resetPassword.fields._password.as('password')}
			autocomplete="new-password"
			minlength="15"
			maxlength="128"
			required
		/></label
	>
	{#each resetPassword.fields.allIssues() ?? [] as issue, i (i)}<p class="issue" role="alert">
			{issue.message}
		</p>{/each}
	<button type="submit" disabled={!!resetPassword.pending}>Update password</button>
</form>
<p class="muted">Paste the code from your email if it is not filled in.</p>
<p><a href="/forgot-password">Request a new reset email</a></p>
