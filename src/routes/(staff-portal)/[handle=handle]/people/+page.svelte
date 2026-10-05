<script lang="ts">
	import { page } from '$app/state';
	import { getWorkspace } from '#lib/remotes/workspace.remote.js';
	import { getPeople } from '#lib/remotes/people.remote.js';
	import FilterChips from '#lib/components/FilterChips.svelte';
	import { refreshOn } from '#lib/live-updates.svelte.js';
	import { PERSON_KINDS, isCurrentRole, summariseRoles, type EntityRoleKind } from '#lib/people.js';

	const workspace = $derived(await getWorkspace(page.params.handle ?? ''));
	const everyone = $derived(await getPeople(workspace.firm.id));
	const base = $derived(`/${workspace.firm.handle}`);
	refreshOn(
		(change) =>
			change.tenantId === workspace.firm.id &&
			(change.targetType === 'person' || change.action.startsWith('entity_role.')),
		() => getPeople(workspace.firm.id).refresh()
	);

	// A directory for looking people up: who they are, where they are involved, how to
	// reach them. Only current roles count; past roles are on each person's page.
	type Person = (typeof everyone)[number];
	const currentRoles = (person: Person) => person.roles.filter((role) => isCurrentRole(role));
	const hasRole = (person: Person, kinds: EntityRoleKind[]) =>
		currentRoles(person).some((role) => kinds.includes(role.role));
	const views = {
		current: { label: 'Current', matches: (p: Person) => currentRoles(p).length > 0 },
		directors: {
			label: 'Directors and members',
			matches: (p: Person) =>
				hasRole(p, ['director', 'secretary', 'llp_member', 'llp_designated_member'])
		},
		owners: {
			label: 'Owners and PSCs',
			matches: (p: Person) => hasRole(p, ['shareholder', 'psc'])
		},
		contacts: { label: 'Contacts', matches: (p: Person) => hasRole(p, ['contact', 'signatory']) },
		past: { label: 'No current role', matches: (p: Person) => currentRoles(p).length === 0 }
	};
	type View = keyof typeof views;
	let view = $state<View>('current');
	let text = $state('');

	const viewOptions = $derived(
		(Object.keys(views) as View[]).map((key) => ({
			value: key,
			label: views[key].label,
			count: everyone.filter(views[key].matches).length
		}))
	);
	const shown = $derived(
		everyone.filter((person) => {
			const wanted = text.trim().toLowerCase();
			const searchable = [
				person.name,
				person.email,
				...person.roles.map((role) => role.entityName)
			];
			return (
				views[view].matches(person) &&
				searchable.some((value) => value?.toLowerCase().includes(wanted))
			);
		})
	);

	/** A person's current roles grouped by entity: one line per entity. */
	function byEntity(person: Person) {
		const roles = currentRoles(person);
		const entityIds = [...new Set(roles.map((role) => role.entityId))];
		return entityIds.map((entityId) => {
			const atEntity = roles.filter((role) => role.entityId === entityId);
			return { entityId, entityName: atEntity[0].entityName, summary: summariseRoles(atEntity) };
		});
	}
</script>

<svelte:head><title>People · {workspace.firm.name}</title></svelte:head>

<div class="page-heading">
	<div>
		<h1>People</h1>
		<p class="muted">
			Directors, owners and contacts across your clients. Find someone and see everywhere they are
			involved.
		</p>
	</div>
</div>

{#if everyone.length}
	<div class="filters">
		<FilterChips label="Show" options={viewOptions} bind:value={view} />
		<label class="filter-search"
			><span class="visually-hidden">Find a person</span><input
				type="search"
				bind:value={text}
				placeholder="Name, email or entity"
			/></label
		>
	</div>
	<div class="table-scroll">
		<table class="client-table">
			<thead>
				<tr>
					<th scope="col">Person</th>
					<th scope="col">Involved with</th>
					<th scope="col" class="desktop-context">Contact</th>
				</tr>
			</thead>
			<tbody>
				{#each shown as person (person.id)}
					{@const groups = byEntity(person)}
					<tr>
						<td>
							<a class="primary-link" href={`${base}/people/${person.id}`}>{person.name}</a>
							{#if person.kind === 'organisation'}<span class="cell-detail"
									>{PERSON_KINDS.organisation}</span
								>{/if}
						</td>
						<td>
							{#if groups.length}
								<ul class="role-lines">
									{#each groups as group (group.entityId)}
										<li>
											<a href={`${base}/entities/${group.entityId}`}>{group.entityName}</a>
											<span class="muted">{group.summary}</span>
										</li>
									{/each}
								</ul>
							{:else}<span class="muted">No current roles</span>{/if}
						</td>
						<td class="desktop-context">
							{#if person.email}<a href={`mailto:${person.email}`}>{person.email}</a>{/if}
							{#if person.phone}<span class="cell-detail">{person.phone}</span>{/if}
							{#if !person.email && !person.phone}<span class="muted">—</span>{/if}
						</td>
					</tr>
				{:else}
					<tr><td colspan="3" class="muted">Nobody matches.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<section class="empty-state">
		<h2>No people yet</h2>
		<p>Add directors and contacts on an entity's page, or import them from Companies House.</p>
	</section>
{/if}
