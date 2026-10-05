<script lang="ts">
	import { page } from '$app/state';
	import { getWorkspace } from '#lib/remotes/workspace.remote.js';
	import { getPeople } from '#lib/remotes/people.remote.js';
	import { refreshOn } from '#lib/live-updates.svelte.js';
	import { ENTITY_ROLES, PERSON_KINDS, isCurrentRole } from '#lib/people.js';

	const workspace = $derived(await getWorkspace(page.params.handle ?? ''));
	const everyone = $derived(await getPeople(workspace.firm.id));
	refreshOn(
		(change) =>
			change.tenantId === workspace.firm.id &&
			(change.targetType === 'person' || change.action.startsWith('entity_role.')),
		() => getPeople(workspace.firm.id).refresh()
	);

	let search = $state('');
	const shown = $derived(
		everyone.filter((person) => person.name.toLowerCase().includes(search.trim().toLowerCase()))
	);
</script>

<svelte:head><title>People · {workspace.firm.name}</title></svelte:head>

<div class="page-heading">
	<div>
		<h1>People</h1>
		<p class="muted">Directors, shareholders, people with significant control and contacts.</p>
	</div>
</div>

{#if everyone.length}
	<label class="workspace-search"
		>Find a person<input type="search" bind:value={search} placeholder="Name" /></label
	>
	<section class="panel roster" aria-label="People">
		{#each shown as person (person.id)}
			{@const current = person.roles.filter((role) => isCurrentRole(role))}
			<div class="roster-row">
				<div>
					<h2><a href={`/${workspace.firm.handle}/people/${person.id}`}>{person.name}</a></h2>
					{#if person.kind === 'organisation'}<span class="badge">{PERSON_KINDS.organisation}</span
						>{/if}
					{#if current.length}
						<ul class="muted">
							{#each current as role, index (index)}<li>
									{ENTITY_ROLES[role.role]},
									<a href={`/${workspace.firm.handle}/entities/${role.entityId}`}
										>{role.entityName}</a
									>
								</li>{/each}
						</ul>
					{:else}<p class="muted">No current roles.</p>{/if}
				</div>
			</div>
		{:else}<p class="muted">Nobody matches “{search}”.</p>{/each}
	</section>
{:else}
	<section class="empty-state">
		<h2>No people yet</h2>
		<p>Add directors and contacts on an entity's page, or import them from Companies House.</p>
	</section>
{/if}
