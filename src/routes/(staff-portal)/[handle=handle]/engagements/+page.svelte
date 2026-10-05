<script lang="ts">
	import { page } from '$app/state';
	import { getWorkspace } from '#lib/remotes/workspace.remote.js';
	import { getFirmEngagements } from '#lib/remotes/engagements.remote.js';
	import EngagementList from '#lib/components/EngagementList.svelte';
	import { isFirmRecordChange, refreshOn } from '#lib/live-updates.svelte.js';
	const workspace = $derived(await getWorkspace(page.params.handle ?? ''));
	const engagements = $derived(await getFirmEngagements(workspace.firm.id));
	refreshOn(
		(change) => isFirmRecordChange(change, workspace.firm.id),
		() => getFirmEngagements(workspace.firm.id).refresh()
	);
</script>

<svelte:head><title>Engagements · {workspace.firm.name}</title></svelte:head>

<div class="page-heading">
	<div>
		<h1>Engagements</h1>
		<p class="muted">
			{workspace.canManage
				? 'Every engagement at the firm. Set them up and organise their teams.'
				: 'The engagements you are assigned to.'}
		</p>
	</div>
	{#if workspace.canManage}<a class="button" href={`/${workspace.firm.handle}/engagements/new`}
			>New engagement</a
		>{/if}
</div>
{#if engagements.length}
	<EngagementList {engagements} canManage={workspace.canManage} />
{:else}
	<section class="empty-state">
		<h2>{workspace.canManage ? 'Start your first engagement' : 'No assigned engagements yet'}</h2>
		<p>
			{workspace.canManage
				? 'Choose a client, legal entity and reporting period to get started.'
				: 'A firm owner or admin will add you to an engagement team.'}
		</p>
	</section>
{/if}
