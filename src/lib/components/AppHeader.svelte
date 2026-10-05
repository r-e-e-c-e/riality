<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { getHeader } from '#lib/remotes/workspace.remote.js';
	import { logout } from '#lib/remotes/auth.remote.js';
	import { WORKSPACE_SEARCH_THRESHOLD } from '#lib/workspaces.js';
	import Avatar from './Avatar.svelte';

	const header = $derived(await getHeader());
	// Close the menus after following a link from them.
	let switcherOpen = $state(false);
	let accountOpen = $state(false);
	afterNavigate(() => {
		switcherOpen = false;
		accountOpen = false;
	});
	// The firm in the URL; on other pages (or a firm you can't open) the one lines.ws/ opens.
	const firmWithHandle = (handle: string | null | undefined) =>
		handle ? header?.workspaces.find((entry) => entry.handle === handle) : undefined;
	const current = $derived(
		firmWithHandle(page.params.handle) ?? firmWithHandle(header?.homeHandle) ?? null
	);
	const canManage = $derived(current?.role === 'owner' || current?.role === 'admin');

	// People in many firms (group staff) get a search box to find one quickly.
	let search = $state('');
	const showSearch = $derived((header?.workspaces.length ?? 0) > WORKSPACE_SEARCH_THRESHOLD);
	const visibleWorkspaces = $derived(
		(header?.workspaces ?? []).filter((entry) =>
			entry.name.toLowerCase().includes(search.trim().toLowerCase())
		)
	);
	const path = $derived(page.url.pathname);
	const isCurrent = (href: string, exact = false) =>
		(exact ? path === href : path === href || path.startsWith(`${href}/`)) ? 'page' : undefined;
</script>

{#if header}
	<header class="topbar">
		<details class="menu workspace-switcher" bind:open={switcherOpen}>
			<summary
				><span class="visually-hidden">Current firm, switch firm: </span>{current?.name ??
					'Your firms'}</summary
			>
			<div class="menu-panel">
				{#if showSearch}
					<input
						class="workspace-search"
						type="search"
						bind:value={search}
						placeholder="Find a firm"
						aria-label="Find a firm"
					/>
				{/if}
				{#if header.workspaces.length}
					<ul class="workspace-list">
						{#each visibleWorkspaces as entry (entry.id)}
							<li>
								<a
									href={`/${entry.handle}`}
									aria-current={entry.id === current?.id ? 'page' : undefined}
									><span>{entry.name}</span>{#if entry.groupName}<span class="muted"
											>{entry.groupName}</span
										>{/if}</a
								>
							</li>
						{:else}
							<li class="muted workspace-empty">No firms match "{search}"</li>
						{/each}
					</ul>
				{/if}
				<a class="menu-item" href="/new-firm">Create a firm</a>
			</div>
		</details>

		{#if current}
			<nav class="navigation" aria-label="Main navigation">
				<a href={`/${current.handle}`} aria-current={isCurrent(`/${current.handle}`, true)}
					>Dashboard</a
				>
				<a
					href={`/${current.handle}/clients`}
					aria-current={isCurrent(`/${current.handle}/clients`)}>Clients</a
				>
				<a
					href={`/${current.handle}/engagements`}
					aria-current={isCurrent(`/${current.handle}/engagements`)}>Engagements</a
				>
				{#if canManage}
					<a
						href={`/${current.handle}/settings`}
						aria-current={isCurrent(`/${current.handle}/settings`)}>Settings</a
					>
				{/if}
			</nav>
		{/if}

		<details class="menu account-menu" bind:open={accountOpen}>
			<summary aria-label={`Account menu for ${header.user.name}`}>
				<Avatar name={header.user.name} color={header.user.avatarColor} />
			</summary>
			<div class="menu-panel menu-panel-end">
				<p class="menu-heading">
					<strong>{header.user.name}</strong><span class="muted">{header.user.email}</span>
				</p>
				<a class="menu-item" href="/account">Manage account</a>
				<form {...logout}><button class="menu-item" type="submit">Sign out</button></form>
			</div>
		</details>
	</header>
{/if}
