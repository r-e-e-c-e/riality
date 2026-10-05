<script lang="ts">
	import { page } from '$app/state';
	import { getWorkspace } from '#lib/remotes/workspace.remote.js';
	import { getMyEngagements } from '#lib/remotes/engagements.remote.js';
	import EngagementList from '#lib/components/EngagementList.svelte';
	import { isFirmRecordChange, refreshOn } from '#lib/live-updates.svelte.js';
	const workspace = $derived(await getWorkspace(page.params.handle ?? ''));
	// Soonest accounts deadline first: what to work on next.
	const engagements = $derived(
		(await getMyEngagements(workspace.firm.id)).toSorted((a, b) =>
			a.accountsDueOn.localeCompare(b.accountsDueOn)
		)
	);
	const base = $derived(`/${workspace.firm.handle}`);
	refreshOn(
		(change) => isFirmRecordChange(change, workspace.firm.id),
		() => getMyEngagements(workspace.firm.id).refresh()
	);
</script>

<svelte:head><title>Dashboard · {workspace.firm.name}</title></svelte:head>

<div class="page-heading">
	<div>
		<h1>Dashboard</h1>
		<p class="muted">Your engagements at {workspace.firm.name}, soonest deadline first.</p>
	</div>
	{#if workspace.canManage}<a class="button" href={`${base}/engagements/new`}>New engagement</a
		>{/if}
</div>

{#if engagements.length}
	<EngagementList {engagements} />
{:else}
	<section class="empty-state">
		<h2>No engagements assigned to you yet</h2>
		{#if workspace.canManage}
			<p>Create an engagement, or assign yourself to one from its team page.</p>
			<p>
				<a class="button secondary" href={`${base}/engagements`}>See all engagements</a>
				<a class="button secondary" href={`${base}/settings`}>Invite your team</a>
			</p>
		{:else}
			<p>A firm owner or admin will add you to an engagement team.</p>
		{/if}
	</section>
{/if}
