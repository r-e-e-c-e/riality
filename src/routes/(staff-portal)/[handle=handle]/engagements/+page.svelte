<script lang="ts">
	import { page } from '$app/state';
	import { getWorkspace } from '#lib/remotes/workspace.remote.js';
	import { getFirmEngagements } from '#lib/remotes/engagements.remote.js';
	import EngagementList from '#lib/components/EngagementList.svelte';
	import FilterChips from '#lib/components/FilterChips.svelte';
	import { deadlineWarning } from '#lib/clients.js';
	import { isFirmRecordChange, refreshOn } from '#lib/live-updates.svelte.js';

	const workspace = $derived(await getWorkspace(page.params.handle ?? ''));
	const engagements = $derived(await getFirmEngagements(workspace.firm.id));
	refreshOn(
		(change) => isFirmRecordChange(change, workspace.firm.id),
		() => getFirmEngagements(workspace.firm.id).refresh()
	);

	// A work queue: soonest accounts deadline first, with quick views for what needs action.
	type Engagement = (typeof engagements)[number];
	const views = {
		all: { label: 'All', matches: () => true },
		mine: { label: 'Mine', matches: (e: Engagement) => e.myRole !== null },
		unstaffed: {
			label: 'Needs a partner',
			matches: (e: Engagement) => !e.team.some((member) => member.role === 'partner')
		},
		due: {
			label: 'Due within 60 days',
			matches: (e: Engagement) => !!deadlineWarning(e.accountsDueOn)
		}
	};
	type View = keyof typeof views;
	let view = $state<View>('all');
	let text = $state('');

	// "All" and "Mine" always show; the others only when something needs attention.
	const viewOptions = $derived(
		(Object.keys(views) as View[])
			.map((key) => ({
				value: key,
				label: views[key].label,
				count: engagements.filter(views[key].matches).length
			}))
			.filter((option) => ['all', 'mine'].includes(option.value) || option.count > 0)
	);
	const shown = $derived(
		engagements
			.filter(views[view].matches)
			.filter((e) =>
				[e.entityName, e.clientName].some((name) =>
					name.toLowerCase().includes(text.trim().toLowerCase())
				)
			)
			.toSorted((a, b) => a.accountsDueOn.localeCompare(b.accountsDueOn))
	);
</script>

<svelte:head><title>Engagements · {workspace.firm.name}</title></svelte:head>

<div class="page-heading">
	<div>
		<h1>Engagements</h1>
		<p class="muted">
			{workspace.canManage
				? 'Every engagement at the firm, soonest deadline first.'
				: 'The engagements you are assigned to, soonest deadline first.'}
		</p>
	</div>
	{#if workspace.canManage}<a class="button" href={`/${workspace.firm.handle}/engagements/new`}
			>New engagement</a
		>{/if}
</div>
{#if engagements.length}
	<div class="filters">
		{#if workspace.canManage}<FilterChips
				label="Show"
				options={viewOptions}
				bind:value={view}
			/>{/if}
		<label class="filter-search"
			><span class="visually-hidden">Find an engagement</span><input
				type="search"
				bind:value={text}
				placeholder="Find by entity or client"
			/></label
		>
	</div>
	{#if shown.length}
		<EngagementList engagements={shown} canManage={workspace.canManage} />
	{:else}
		<p class="muted">No engagements match.</p>
	{/if}
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
