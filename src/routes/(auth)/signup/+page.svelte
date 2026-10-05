<script lang="ts">
	import { getAuthPolicy } from '#lib/remotes/auth.remote.js';
	import { signup } from './signup.remote';
	const policy = getAuthPolicy();
</script>

<svelte:head><title>Create an account · Lines</title></svelte:head>
<h1>Create your account</h1>
<p>Verify your email, then choose your password.</p>
{#if (await policy).signup === 'invitation'}<p>
		Your firm must invite this email address first.
	</p>{/if}
<form {...signup}>
	<label
		>Name<input
			{...signup.fields.name.as('text')}
			autocomplete="name"
			required
			maxlength="160"
		/></label
	>
	<label
		>Work email<input
			{...signup.fields.email.as('email')}
			autocomplete="email"
			required
			maxlength="254"
		/></label
	>
	{#each signup.fields.allIssues() ?? [] as issue, i (i)}<p class="issue" role="alert">
			{issue.message}
		</p>{/each}
	{#if signup.result}<p role="status">{signup.result.message}</p>{/if}
	<button type="submit" disabled={!!signup.pending}>Send verification email</button>
</form>
<p><a href="/login">Already have an account? Sign in</a></p>
