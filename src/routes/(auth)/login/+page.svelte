<script lang="ts">
	import { page } from '$app/state';
	import { login } from './login.remote';
</script>

<svelte:head><title>Sign in · Lines</title></svelte:head>

<h1>Sign in</h1>
<p>Continue your firm's work.</p>
{#if page.url.searchParams.has('created')}<p role="status">
		Your email is verified. Sign in to continue.
	</p>{/if}
{#if page.url.searchParams.has('reset')}<p role="status">Password updated. Sign in again.</p>{/if}
<form {...login}>
	<input {...login.fields.next.as('hidden', page.url.searchParams.get('next') ?? '')} />
	<label
		>Email
		<input {...login.fields.email.as('email')} autocomplete="username" required maxlength="254" />
	</label>
	<label
		>Password
		<input
			{...login.fields._password.as('password')}
			autocomplete="current-password"
			required
			maxlength="128"
		/>
	</label>
	<label
		>Security code (if MFA is enabled)<input
			{...login.fields._code.as('text')}
			autocomplete="one-time-code"
			maxlength="64"
		/></label
	>
	{#each login.fields.allIssues() ?? [] as issue, i (i)}
		<p class="issue" role="alert">{issue.message}</p>
	{/each}
	<button type="submit" disabled={!!login.pending}>Sign in</button>
</form>
<p><a href="/forgot-password">Forgot your password?</a></p>
<p><a href="/signup">Create an account</a></p>
