<script lang="ts">
	import { page } from '$app/state';

	// What to tell the user about page.error, and what they can do next.
	// 404 wording is deliberately the same whether something is missing or private.
	const signInLink = $derived(
		`/login?next=${encodeURIComponent(page.url.pathname + page.url.search)}`
	);
	const view = $derived.by(() => {
		const code = page.error?.code;
		if (code === 'MFA_SETUP_REQUIRED')
			return {
				title: 'Set up MFA to continue',
				text: 'Your firm requires an authenticator app before you can open firm work.',
				action: { href: '/account', label: 'Go to Manage account' }
			};
		if (code === 'RECENT_SIGN_IN_REQUIRED')
			return {
				title: "Confirm it's you",
				text: 'This change needs your password again. Confirm your identity, then try again.',
				action: { href: '/account', label: 'Confirm your identity' }
			};
		if (page.status === 401)
			return {
				title: 'Your session has ended',
				text: 'Sign in again to carry on where you left off.',
				action: { href: signInLink, label: 'Sign in' }
			};
		if (page.status === 403)
			return {
				title: "You don't have access to this",
				text: page.error?.message ?? 'Ask a firm owner if you think you should have access.',
				action: { href: '/', label: 'Back to your work' }
			};
		if (page.status === 404)
			return {
				title: 'Not found',
				text: "This page doesn't exist, or you don't have access to it. Ask a firm owner if you think you should.",
				action: { href: '/', label: 'Back to your work' }
			};
		if (page.status === 429)
			return {
				title: 'Too many attempts',
				text: page.error?.message ?? 'Wait a few minutes and try again.',
				action: null
			};
		if (page.status < 500)
			return {
				title: 'Something is not right',
				text: page.error?.message ?? 'Please try again.',
				action: { href: '/', label: 'Back to your work' }
			};
		return {
			title: 'Something went wrong',
			text: page.error?.message ?? 'Please try again.',
			action: { href: '/', label: 'Back to your work' }
		};
	});
</script>

<svelte:head><title>{view.title}</title></svelte:head>

<h1>{view.title}</h1>
<p>{view.text}</p>
{#if page.error?.reference}
	<p class="muted">
		If this keeps happening, contact support and quote reference
		<code>{page.error.reference}</code>.
	</p>
{/if}
{#if view.action}<p><a class="button" href={view.action.href}>{view.action.label}</a></p>{/if}
