<script lang="ts">
	import FormFeedback from '#lib/components/FormFeedback.svelte';
	import { formatDate } from '#lib/format.js';
	import { refreshOn } from '#lib/live-updates.svelte.js';
	import { keysOf } from '#lib/companies.js';
	import { CONTROL_KINDS, ENTITY_ROLES, PERSON_KINDS, isCurrentRole } from '#lib/people.js';
	import { getPeople } from '#lib/remotes/people.remote.js';
	import { addRole, getEntityPeople, importPeople, removeRole, updateRole } from './entity.remote';

	// The people with roles at an entity. Owners and admins can add, edit and import them.
	let {
		scope,
		handle,
		canManage,
		canImport
	}: {
		scope: { firmId: string; entityId: string };
		handle: string;
		canManage: boolean;
		/** Companies House is set up and the entity has a company number. */
		canImport: boolean;
	} = $props();

	const roles = $derived(await getEntityPeople(scope));
	const current = $derived(roles.filter((role) => isCurrentRole(role)));
	const past = $derived(roles.filter((role) => !isCurrentRole(role)));
	// Everyone at the firm, to choose an existing person when adding a role.
	const everyone = $derived(canManage ? await getPeople(scope.firmId) : []);

	refreshOn(
		(change) => change.targetType === 'entity' && change.targetId === scope.entityId,
		() => getEntityPeople(scope).refresh()
	);
	refreshOn(
		(change) => canManage && change.tenantId === scope.firmId && change.targetType === 'person',
		() => getPeople(scope.firmId).refresh()
	);

	const dates = (role: { startedOn: string | null; endedOn: string | null }) =>
		`${role.startedOn ? formatDate(role.startedOn) : 'Unknown start'} – ${role.endedOn ? formatDate(role.endedOn) : 'present'}`;
</script>

{#snippet roleRow(role: (typeof roles)[number])}
	{@const edit = updateRole.for(role.id)}
	{@const remove = removeRole.for(role.id)}
	<div class="roster-row">
		<div>
			<h3>
				{#if canManage}<a href={`/${handle}/people/${role.personId}`}>{role.personName}</a
					>{:else}{role.personName}{/if}
			</h3>
			<p class="muted">
				{ENTITY_ROLES[role.role]}{#if role.shareholdingPercent !== null}, {role.shareholdingPercent}%{/if}
				· {dates(role)}{#if role.personKind === 'organisation'}
					· {PERSON_KINDS.organisation}{/if}
			</p>
			{#if role.controls.length}
				<p class="muted">{role.controls.map((control) => CONTROL_KINDS[control]).join('; ')}</p>
			{/if}
		</div>
		{#if canManage}
			<details open={!!edit.fields.allIssues()?.length}>
				<summary aria-label={`Edit ${ENTITY_ROLES[role.role]} role for ${role.personName}`}
					>Edit</summary
				>
				<form {...edit}>
					<input {...edit.fields.firmId.as('hidden', scope.firmId)} />
					<input {...edit.fields.roleId.as('hidden', role.id)} />
					<div class="field-pair">
						<label
							>Started on<input
								{...edit.fields.startedOn.as('date', role.startedOn ?? '')}
							/></label
						>
						<label>Ended on<input {...edit.fields.endedOn.as('date', role.endedOn ?? '')} /></label>
					</div>
					{#if role.role === 'shareholder'}
						<label
							>Shareholding (%)<input
								{...edit.fields.shareholdingPercent.as(
									'text',
									role.shareholdingPercent === null ? '' : String(role.shareholdingPercent)
								)}
								inputmode="decimal"
							/></label
						>
					{/if}
					<FormFeedback issues={edit.fields.allIssues()} message={edit.result?.message} />
					<button class="secondary" type="submit" disabled={!!edit.pending}>Save role</button>
				</form>
				<form {...remove}>
					<input {...remove.fields.firmId.as('hidden', scope.firmId)} />
					<input {...remove.fields.roleId.as('hidden', role.id)} />
					<p class="muted">Entered by mistake? To record that the role ended, set its end date.</p>
					<FormFeedback issues={remove.fields.allIssues()} />
					<button class="secondary" type="submit" disabled={!!remove.pending}>Remove role</button>
				</form>
			</details>
		{/if}
	</div>
{/snippet}

<section class="panel" aria-labelledby="people-heading">
	<h2 id="people-heading">People</h2>
	{#if current.length}
		<div class="roster">
			{#each current as role (role.id)}{@render roleRow(role)}{/each}
		</div>
	{:else}
		<p class="muted">No current directors, shareholders or contacts recorded.</p>
	{/if}
	{#if past.length}
		<details class="disclosure">
			<summary>Past roles ({past.length})</summary>
			<div class="roster">
				{#each past as role (role.id)}{@render roleRow(role)}{/each}
			</div>
		</details>
	{/if}
	{#if canManage && canImport}
		<form {...importPeople}>
			<input {...importPeople.fields.firmId.as('hidden', scope.firmId)} />
			<input {...importPeople.fields.entityId.as('hidden', scope.entityId)} />
			<FormFeedback
				issues={importPeople.fields.allIssues()}
				message={importPeople.result?.message}
			/>
			<button class="secondary" type="submit" disabled={!!importPeople.pending}
				>Import officers and PSCs from Companies House</button
			>
		</form>
	{/if}
</section>

{#if canManage}
	<details class="panel disclosure" open={!!addRole.fields.allIssues()?.length}>
		<summary>Add a person</summary>
		<form {...addRole}>
			<input {...addRole.fields.firmId.as('hidden', scope.firmId)} />
			<input {...addRole.fields.entityId.as('hidden', scope.entityId)} />
			{#if everyone.length}
				<label
					>Person<select {...addRole.fields.personId.as('select', '')}
						><option value="">Someone new</option>{#each everyone as person (person.id)}<option
								value={person.id}>{person.name}</option
							>{/each}</select
					></label
				>
			{/if}
			<div class="field-pair">
				<label
					>Name <span class="muted">(someone new)</span><input
						{...addRole.fields.name.as('text')}
						maxlength="160"
					/></label
				>
				<label
					>Kind<select {...addRole.fields.kind.as('select', 'individual')}
						>{#each keysOf(PERSON_KINDS) as kind (kind)}<option value={kind}
								>{PERSON_KINDS[kind]}</option
							>{/each}</select
					></label
				>
			</div>
			<label
				>Role<select {...addRole.fields.role.as('select', 'director')}
					>{#each keysOf(ENTITY_ROLES) as role (role)}<option value={role}
							>{ENTITY_ROLES[role]}</option
						>{/each}</select
				></label
			>
			<div class="field-pair">
				<label>Started on<input {...addRole.fields.startedOn.as('date')} /></label>
				<label>Ended on<input {...addRole.fields.endedOn.as('date')} /></label>
			</div>
			<label
				>Shareholding (%) <span class="muted">(shareholders only)</span><input
					{...addRole.fields.shareholdingPercent.as('text')}
					inputmode="decimal"
				/></label
			>
			<FormFeedback issues={addRole.fields.allIssues()} message={addRole.result?.message} />
			<button type="submit" disabled={!!addRole.pending}>Add person</button>
		</form>
	</details>
{/if}
