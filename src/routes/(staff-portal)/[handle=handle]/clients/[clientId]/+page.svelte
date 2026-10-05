<script lang="ts">
	import { page } from '$app/state';
	import { getMembers, getWorkspace } from '#lib/remotes/workspace.remote.js';
	import FormFeedback from '#lib/components/FormFeedback.svelte';
	import { CLIENT_STATUSES, RISK_RATINGS, deadlineWarning, isReviewDue } from '#lib/clients.js';
	import { COMPANY_STATUSES, ENTITY_TYPES, keysOf } from '#lib/companies.js';
	import { formatDate, formatYearEnd } from '#lib/format.js';
	import { isFirmRecordChange, refreshOn } from '#lib/live-updates.svelte.js';
	import { ENTITY_ROLES, isCurrentRole } from '#lib/people.js';
	import { getClient, updateClient } from './client.remote';

	const workspace = $derived(await getWorkspace(page.params.handle ?? ''));
	const scope = $derived({ firmId: workspace.firm.id, clientId: page.params.clientId ?? '' });
	const client = $derived(await getClient(scope));
	const members = $derived(workspace.canManage ? await getMembers(scope.firmId) : []);
	const base = $derived(`/${workspace.firm.handle}`);
	refreshOn(
		(change) => isFirmRecordChange(change, scope.firmId),
		() => getClient(scope).refresh()
	);
	refreshOn(
		(change) =>
			workspace.canManage &&
			change.tenantId === scope.firmId &&
			change.action.startsWith('membership.'),
		() => getMembers(scope.firmId).refresh()
	);

	// The people grid: one row per person, one column per entity, roles in the cells.
	let showPastRoles = $state(false);
	const grid = $derived(
		client.people
			.map((person) => ({
				...person,
				roles: person.roles.filter((role) => showPastRoles || isCurrentRole(role))
			}))
			.filter((person) => person.roles.length > 0)
	);
	function roleLabel(role: (typeof client.people)[number]['roles'][number]) {
		const label =
			role.role === 'psc'
				? 'PSC'
				: role.shareholdingPercent !== null
					? `${role.shareholdingPercent}% shareholder`
					: ENTITY_ROLES[role.role];
		return isCurrentRole(role) ? label : `${label} (until ${formatDate(role.endedOn!)})`;
	}
	const deadline = $derived(deadlineWarning(client.nextAccountsDue));
	const reviewDue = $derived(client.status !== 'former' && isReviewDue(client.lastReviewedOn));
</script>

<svelte:head><title>{client.name} · {workspace.firm.name}</title></svelte:head>

<div class="page-heading">
	<div>
		<p class="eyebrow"><a href={`${base}/clients`}>Clients</a></p>
		<h1>{client.name}</h1>
		<p>
			<span class="badge">{CLIENT_STATUSES[client.status]}</span>
			{#if client.riskRating}<span class="badge" class:warning={client.riskRating === 'high'}
					>{RISK_RATINGS[client.riskRating]} risk</span
				>{/if}
		</p>
	</div>
</div>

<section class="panel">
	<h2>Overview</h2>
	<dl class="details">
		<dt>Partner</dt>
		<dd>{client.partner?.name ?? 'Not assigned'}</dd>
		<dt>Manager</dt>
		<dd>{client.manager?.name ?? 'Not assigned'}</dd>
		<dt>Key contact</dt>
		<dd>
			{#if client.keyContact}
				{client.keyContact.name}
				{#if client.keyContact.email}<a
						class="cell-detail"
						href={`mailto:${client.keyContact.email}`}>{client.keyContact.email}</a
					>{/if}
				{#if client.keyContact.phone}<a
						class="cell-detail"
						href={`tel:${client.keyContact.phone.replaceAll(' ', '')}`}>{client.keyContact.phone}</a
					>{/if}
			{:else}Not chosen{/if}
		</dd>
		<dt>Next accounts due</dt>
		<dd>
			{client.nextAccountsDue ? formatDate(client.nextAccountsDue) : 'None'}
			{#if deadline}<span class="cell-detail" class:urgent={deadline.urgent}>{deadline.text}</span
				>{/if}
		</dd>
		<dt>Acceptance last reviewed</dt>
		<dd>
			{client.lastReviewedOn ? formatDate(client.lastReviewedOn) : 'Not recorded'}
			{#if reviewDue}<span class="badge warning">Review due</span>{/if}
		</dd>
	</dl>
</section>

<section class="panel" aria-labelledby="entities-heading">
	<h2 id="entities-heading">Legal entities</h2>
	{#if client.entities.length}
		<div class="table-scroll">
			<table class="client-table">
				<thead>
					<tr>
						<th scope="col">Entity</th>
						<th scope="col">Company number</th>
						<th scope="col">Year end</th>
						<th scope="col">Next accounts due</th>
						<th scope="col">Latest engagement</th>
					</tr>
				</thead>
				<tbody>
					{#each client.entities as entity (entity.id)}
						{@const warning = deadlineWarning(entity.accountsNextDueOn)}
						<tr>
							<td>
								<a class="primary-link" href={`${base}/entities/${entity.id}`}>{entity.name}</a>
								<span class="cell-detail"
									>{ENTITY_TYPES[
										entity.entityType
									]}{#if entity.companyStatus && entity.companyStatus !== 'active'}
										· {COMPANY_STATUSES[entity.companyStatus]}{/if}</span
								>
							</td>
							<td>{entity.companyNumber ?? '—'}</td>
							<td class="nowrap">{formatYearEnd(entity.yearEndDay, entity.yearEndMonth) ?? '—'}</td>
							<td class="nowrap">
								{entity.accountsNextDueOn ? formatDate(entity.accountsNextDueOn) : '—'}
								{#if warning}<span class="cell-detail" class:urgent={warning.urgent}
										>{warning.text}</span
									>{/if}
							</td>
							<td>
								{#if entity.engagement}
									{#if entity.engagement.onTeam}<a
											href={`${base}/engagements/${entity.engagement.id}`}
											>Audit to {formatDate(entity.engagement.periodEnd)}</a
										>{:else}Audit to {formatDate(entity.engagement.periodEnd)}{/if}
								{:else}<span class="muted">None</span>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}<p class="muted">No legal entities yet. Add them on the Clients page.</p>{/if}
</section>

<section class="panel" aria-labelledby="people-heading">
	<h2 id="people-heading">People</h2>
	<p class="muted">
		Directors, shareholders, people with significant control and contacts, by entity.
	</p>
	<label class="checkbox"
		><input type="checkbox" bind:checked={showPastRoles} /> Include past roles</label
	>
	{#if grid.length}
		<div class="table-scroll">
			<table class="client-table people-grid">
				<thead>
					<tr>
						<th scope="col">Person</th>
						{#each client.entities as entity (entity.id)}<th scope="col">{entity.name}</th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each grid as person (person.personId)}
						<tr>
							<th scope="row">
								{#if workspace.canManage}<a href={`${base}/people/${person.personId}`}
										>{person.name}</a
									>{:else}{person.name}{/if}
								{#if person.email}<a class="cell-detail" href={`mailto:${person.email}`}
										>{person.email}</a
									>{/if}
								{#if person.phone}<span class="cell-detail">{person.phone}</span>{/if}
							</th>
							{#each client.entities as entity (entity.id)}
								{@const roles = person.roles.filter((role) => role.entityId === entity.id)}
								<td>
									{#if roles.length}
										<ul>
											{#each roles as role, index (index)}<li class:muted={!isCurrentRole(role)}>
													{roleLabel(role)}
												</li>{/each}
										</ul>
									{:else}<span class="muted">—</span>{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="muted">No people recorded. Add them on each entity's page.</p>
	{/if}
</section>

{#if workspace.canManage}
	<details class="panel disclosure" open={!!updateClient.fields.allIssues()?.length}>
		<summary>Edit client details</summary>
		<form {...updateClient}>
			<input {...updateClient.fields.firmId.as('hidden', scope.firmId)} />
			<input {...updateClient.fields.clientId.as('hidden', scope.clientId)} />
			<label
				>Client name<input
					{...updateClient.fields.name.as('text', client.name)}
					required
					maxlength="160"
				/></label
			>
			<label
				>Status<select {...updateClient.fields.status.as('select', client.status)}
					>{#each keysOf(CLIENT_STATUSES) as status (status)}<option value={status}
							>{CLIENT_STATUSES[status]}</option
						>{/each}</select
				></label
			>
			<div class="field-pair">
				<label
					>Partner<select {...updateClient.fields.partnerId.as('select', client.partner?.id ?? '')}
						><option value="">Not assigned</option>{#each members as member (member.userId)}<option
								value={member.userId}>{member.name}</option
							>{/each}</select
					></label
				>
				<label
					>Manager<select {...updateClient.fields.managerId.as('select', client.manager?.id ?? '')}
						><option value="">Not assigned</option>{#each members as member (member.userId)}<option
								value={member.userId}>{member.name}</option
							>{/each}</select
					></label
				>
			</div>
			<label
				>Key contact<select
					{...updateClient.fields.keyContactId.as('select', client.keyContact?.id ?? '')}
					><option value="">Not chosen</option
					>{#each client.people as person (person.personId)}<option value={person.personId}
							>{person.name}</option
						>{/each}</select
				></label
			>
			<div class="field-pair">
				<label
					>Risk rating<select
						{...updateClient.fields.riskRating.as('select', client.riskRating ?? '')}
						><option value="">Not assessed</option
						>{#each keysOf(RISK_RATINGS) as rating (rating)}<option value={rating}
								>{RISK_RATINGS[rating]}</option
							>{/each}</select
					></label
				>
				<label
					>Acceptance last reviewed<input
						{...updateClient.fields.lastReviewedOn.as('date', client.lastReviewedOn ?? '')}
					/></label
				>
			</div>
			<FormFeedback
				issues={updateClient.fields.allIssues()}
				message={updateClient.result?.message}
			/>
			<button type="submit" disabled={!!updateClient.pending}>Save details</button>
		</form>
	</details>
{/if}
