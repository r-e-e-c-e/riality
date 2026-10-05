<script lang="ts">
	import { page } from '$app/state';
	import { getWorkspace } from '#lib/remotes/workspace.remote.js';
	import { refreshOn } from '#lib/live-updates.svelte.js';
	import FormFeedback from '#lib/components/FormFeedback.svelte';
	import { formatDate, formatMonth } from '#lib/format.js';
	import { ENTITY_ROLES, PERSON_KINDS, isCurrentRole } from '#lib/people.js';
	import { getPerson, updatePerson } from './person.remote';

	const workspace = $derived(await getWorkspace(page.params.handle ?? ''));
	const scope = $derived({ firmId: workspace.firm.id, personId: page.params.personId ?? '' });
	const person = $derived(await getPerson(scope));
	const entityIds = $derived(new Set(person.roles.map((role) => role.entityId)));
	refreshOn(
		(change) =>
			(change.targetType === 'person' && change.targetId === scope.personId) ||
			(change.targetType === 'entity' && entityIds.has(change.targetId ?? '')),
		() => getPerson(scope).refresh()
	);
</script>

<svelte:head><title>{person.name} · {workspace.firm.name}</title></svelte:head>

<div class="page-heading">
	<div>
		<p class="eyebrow"><a href={`/${workspace.firm.handle}/people`}>People</a></p>
		<h1>{person.name}</h1>
		<p class="muted">{PERSON_KINDS[person.kind]}</p>
	</div>
</div>

<section class="panel">
	<h2>Contact details</h2>
	<dl class="details">
		<dt>Email</dt>
		<dd>{person.email ?? 'Not recorded'}</dd>
		<dt>Phone</dt>
		<dd>{person.phone ?? 'Not recorded'}</dd>
		{#if person.birthMonth && person.birthYear}
			<dt>Born</dt>
			<dd>{formatMonth(person.birthYear, person.birthMonth)}</dd>
		{/if}
	</dl>
</section>

<section class="panel" aria-labelledby="roles-heading">
	<h2 id="roles-heading">Roles</h2>
	{#if person.roles.length}
		<div class="table-scroll">
			<table>
				<thead><tr><th>Entity</th><th>Role</th><th>From</th><th>To</th></tr></thead>
				<tbody>
					{#each person.roles as role (role.id)}
						<tr class:muted={!isCurrentRole(role)}>
							<td
								><a href={`/${workspace.firm.handle}/entities/${role.entityId}`}
									>{role.entityName}</a
								></td
							>
							<td
								>{ENTITY_ROLES[role.role]}{#if role.shareholdingPercent !== null}, {role.shareholdingPercent}%{/if}</td
							>
							<td>{role.startedOn ? formatDate(role.startedOn) : 'Unknown'}</td>
							<td>{role.endedOn ? formatDate(role.endedOn) : 'Present'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}<p class="muted">No roles recorded.</p>{/if}
</section>

<details class="panel disclosure" open={!!updatePerson.fields.allIssues()?.length}>
	<summary>Edit details</summary>
	<form {...updatePerson}>
		<input {...updatePerson.fields.firmId.as('hidden', scope.firmId)} />
		<input {...updatePerson.fields.personId.as('hidden', scope.personId)} />
		<label
			>Name<input
				{...updatePerson.fields.name.as('text', person.name)}
				required
				maxlength="160"
			/></label
		>
		<label>Email<input {...updatePerson.fields.email.as('email', person.email ?? '')} /></label>
		<label>Phone<input {...updatePerson.fields.phone.as('tel', person.phone ?? '')} /></label>
		<FormFeedback issues={updatePerson.fields.allIssues()} message={updatePerson.result?.message} />
		<button type="submit" disabled={!!updatePerson.pending}>Save details</button>
	</form>
</details>
