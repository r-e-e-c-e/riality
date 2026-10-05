<script lang="ts">
	import { page } from '$app/state';
	import { getHeader, getWorkspace } from '#lib/remotes/workspace.remote.js';
	import {
		createClient,
		createEntity,
		getClientDirectory,
		getCompaniesHouseEnabled,
		searchCompanies
	} from '#lib/remotes/clients.remote.js';
	import FormFeedback from '#lib/components/FormFeedback.svelte';
	import { CLIENT_STATUSES, deadlineWarning, isReviewDue } from '#lib/clients.js';
	import { COMPANY_STATUSES, ENTITY_TYPES, keysOf } from '#lib/companies.js';
	import { formatDate, formatYearEnd } from '#lib/format.js';
	import { isFirmRecordChange, refreshOn } from '#lib/live-updates.svelte.js';

	const workspace = $derived(await getWorkspace(page.params.handle ?? ''));
	const header = $derived(await getHeader());
	const directory = $derived(await getClientDirectory(workspace.firm.id));
	const companiesHouseEnabled = $derived(await getCompaniesHouseEnabled());
	const base = $derived(`/${workspace.firm.handle}`);
	refreshOn(
		(change) => isFirmRecordChange(change, workspace.firm.id),
		() => getClientDirectory(workspace.firm.id).refresh()
	);

	// Finding clients: by text, status and "mine", sorted by name or deadline.
	type Client = (typeof directory)[number];
	let text = $state('');
	let show = $state<'current' | 'all' | keyof typeof CLIENT_STATUSES>('current');
	let onlyMine = $state(false);
	let sortBy = $state<'name' | 'deadline'>('name');

	function isMine(client: Client) {
		const me = header?.user.id;
		return (
			client.partner?.id === me ||
			client.manager?.id === me ||
			client.entities.some((entity) => entity.engagement?.onTeam)
		);
	}
	function matchesText(client: Client) {
		const wanted = text.trim().toLowerCase();
		const searchable = [
			client.name,
			client.keyContact?.name,
			...client.entities.flatMap((entity) => [entity.name, entity.companyNumber])
		];
		return searchable.some((value) => value?.toLowerCase().includes(wanted));
	}
	function hasStatus(client: Client) {
		if (show === 'all') return true;
		if (show === 'current') return client.status !== 'former';
		return client.status === show;
	}
	const byDeadline = (a: Client, b: Client) =>
		(a.nextAccountsDue ?? '9999').localeCompare(b.nextAccountsDue ?? '9999');
	const matching = $derived(
		directory.filter(
			(client) => hasStatus(client) && (!onlyMine || isMine(client)) && matchesText(client)
		)
	);
	// The list arrives sorted by name.
	const shown = $derived(sortBy === 'deadline' ? matching.toSorted(byDeadline) : matching);

	// Companies House search (needs JavaScript). Choosing a result fills the company number.
	let searchText = $state('');
	let search = $state('');
	const results = $derived(
		search.length >= 2 ? await searchCompanies({ firmId: workspace.firm.id, query: search }) : []
	);
	function choose(companyNumber: string) {
		createEntity.fields.companyNumber.set(companyNumber);
		search = '';
	}
</script>

<svelte:head><title>Clients · {workspace.firm.name}</title></svelte:head>

<div class="page-heading">
	<div>
		<h1>Clients</h1>
		<p class="muted">
			{workspace.canManage
				? 'Clients, their legal entities, deadlines and who looks after them.'
				: 'Clients of the engagements you are assigned to.'}
		</p>
	</div>
</div>

{#if directory.length}
	<div class="filters" role="search">
		<label
			>Find<input
				type="search"
				bind:value={text}
				placeholder="Client, entity, company number or contact"
			/></label
		>
		<label
			>Show<select bind:value={show}
				><option value="current">Current clients</option
				>{#each keysOf(CLIENT_STATUSES) as status (status)}<option value={status}
						>{CLIENT_STATUSES[status]}</option
					>{/each}<option value="all">All</option></select
			></label
		>
		<label
			>Sort by<select bind:value={sortBy}
				><option value="name">Name</option><option value="deadline">Next deadline</option></select
			></label
		>
		<label class="checkbox"><input type="checkbox" bind:checked={onlyMine} /> Only my clients</label
		>
	</div>
	<p class="muted" role="status">Showing {shown.length} of {directory.length} clients.</p>

	<div class="table-scroll">
		<table class="client-table">
			<thead>
				<tr>
					<th scope="col">Client</th>
					<th scope="col">Next accounts due</th>
					<th scope="col">Partner and manager</th>
					<th scope="col">Key contact</th>
				</tr>
			</thead>
			<tbody>
				{#each shown as client (client.id)}
					{@const warning = deadlineWarning(client.nextAccountsDue)}
					<tr>
						<td>
							<a class="primary-link" href={`${base}/clients/${client.id}`}>{client.name}</a>
							{#if client.status !== 'active'}<span class="badge"
									>{CLIENT_STATUSES[client.status]}</span
								>{/if}
							{#if client.riskRating === 'high'}<span class="badge warning">High risk</span>{/if}
							{#if workspace.canManage && client.status !== 'former' && isReviewDue(client.lastReviewedOn)}<span
									class="badge warning">Review due</span
								>{/if}
							<ul class="entity-lines">
								{#each client.entities as entity (entity.id)}
									<li>
										<a href={`${base}/entities/${entity.id}`}>{entity.name}</a>
										{#if entity.companyNumber}· {entity.companyNumber}{/if}
										{#if entity.companyStatus && entity.companyStatus !== 'active'}·
											{COMPANY_STATUSES[entity.companyStatus]}{/if}
										{#if formatYearEnd(entity.yearEndDay, entity.yearEndMonth)}· Year end {formatYearEnd(
												entity.yearEndDay,
												entity.yearEndMonth
											)}{/if}
										{#if entity.engagement}·
											{#if entity.engagement.onTeam}<a
													href={`${base}/engagements/${entity.engagement.id}`}
													>Audit to {formatDate(entity.engagement.periodEnd)}</a
												>{:else}Audit to {formatDate(entity.engagement.periodEnd)}{/if}{/if}
									</li>
								{:else}<li>No legal entities yet.</li>{/each}
							</ul>
						</td>
						<td class="nowrap">
							{client.nextAccountsDue ? formatDate(client.nextAccountsDue) : '—'}
							{#if warning}<span class="cell-detail" class:urgent={warning.urgent}
									>{warning.text}</span
								>{/if}
						</td>
						<td>
							{client.partner?.name ?? 'No partner'}
							{#if client.manager}<span class="cell-detail">{client.manager.name}</span>{/if}
						</td>
						<td>
							{#if client.keyContact}
								{client.keyContact.name}
								{#if client.keyContact.email}<a
										class="cell-detail"
										href={`mailto:${client.keyContact.email}`}>{client.keyContact.email}</a
									>{/if}
								{#if client.keyContact.phone}<a
										class="cell-detail"
										href={`tel:${client.keyContact.phone.replaceAll(' ', '')}`}
										>{client.keyContact.phone}</a
									>{/if}
							{:else}<span class="muted">—</span>{/if}
						</td>
					</tr>
				{:else}
					<tr><td colspan="4" class="muted">No clients match.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<section class="empty-state">
		<h2>No clients yet</h2>
		<p>
			{workspace.canManage
				? 'Add a client, then the legal entities you audit for them.'
				: 'Clients appear here when you are assigned to one of their engagements.'}
		</p>
	</section>
{/if}

{#if workspace.canManage}
	<details class="panel disclosure" open={!!createClient.fields.allIssues()?.length}>
		<summary>Add a client</summary>
		<form {...createClient}>
			<input {...createClient.fields.firmId.as('hidden', workspace.firm.id)} />
			<label
				>Client name<input
					{...createClient.fields.name.as('text')}
					required
					maxlength="160"
				/></label
			>
			<label
				>Status<select {...createClient.fields.status.as('select', 'active')}
					>{#each keysOf(CLIENT_STATUSES) as status (status)}<option value={status}
							>{CLIENT_STATUSES[status]}</option
						>{/each}</select
				></label
			>
			<FormFeedback
				issues={createClient.fields.allIssues()}
				message={createClient.result?.message}
			/>
			<button type="submit" disabled={!!createClient.pending}>Add client</button>
		</form>
	</details>
	{#if directory.length}
		<details class="panel disclosure" open={!!createEntity.fields.allIssues()?.length}>
			<summary>Add a legal entity</summary>
			<form {...createEntity}>
				<input {...createEntity.fields.firmId.as('hidden', workspace.firm.id)} />
				<label
					>Client<select {...createEntity.fields.clientId.as('select')} required
						><option value="">Choose a client</option>{#each directory as client (client.id)}<option
								value={client.id}>{client.name}</option
							>{/each}</select
					></label
				>
				{#if companiesHouseEnabled}
					<div class="field-group">
						<label
							>Find on Companies House<input
								type="search"
								bind:value={searchText}
								placeholder="Company name or number"
							/></label
						>
						<button type="button" class="secondary" onclick={() => (search = searchText.trim())}
							>Search</button
						>
						{#if results.length}
							<ul class="search-results">
								{#each results as result (result.companyNumber)}
									<li>
										<button
											type="button"
											class="text-button"
											onclick={() => choose(result.companyNumber)}
											>{result.name} · {result.companyNumber}
											{#if result.status !== 'active'}· {COMPANY_STATUSES[
													result.status
												]}{/if}</button
										>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/if}
				<label
					>Company number
					<span class="muted"
						>{companiesHouseEnabled
							? 'The details are filled in from Companies House.'
							: 'Optional.'}</span
					>
					<input {...createEntity.fields.companyNumber.as('text')} maxlength="10" /></label
				>
				<label
					>Name <span class="muted">(if it has no company number)</span><input
						{...createEntity.fields.name.as('text')}
						maxlength="160"
					/></label
				>
				<label
					>Type<select {...createEntity.fields.entityType.as('select', 'private_limited')}
						>{#each keysOf(ENTITY_TYPES) as type (type)}<option value={type}
								>{ENTITY_TYPES[type]}</option
							>{/each}</select
					></label
				>
				<FormFeedback
					issues={createEntity.fields.allIssues()}
					message={createEntity.result?.message}
				/>
				<button type="submit" disabled={!!createEntity.pending}>Add entity</button>
			</form>
		</details>
	{/if}
{/if}
