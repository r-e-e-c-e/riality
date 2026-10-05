<script lang="ts">
	import { requestReset } from './forgot-password.remote';
</script>

<svelte:head><title>Reset your password · Lines</title></svelte:head>
<h1>Reset your password</h1>
<form {...requestReset}>
	<label
		>Email<input
			{...requestReset.fields.email.as('email')}
			autocomplete="email"
			required
			maxlength="254"
		/></label
	>
	{#each requestReset.fields.allIssues() ?? [] as issue, i (i)}<p class="issue" role="alert">
			{issue.message}
		</p>{/each}
	{#if requestReset.result}<p role="status">{requestReset.result.message}</p>{/if}
	<button type="submit" disabled={!!requestReset.pending}>Send reset email</button>
</form>
<p><a href="/login">Return to sign in</a></p>
