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
	import FilterChips from '#lib/components/FilterChips.svelte';
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

	// Quick views: the current book, my clients, then anything needing attention.
	type Client = (typeof directory)[number];
	const isCurrent = (client: Client) => client.status !== 'former';
	const views = {
		current: { label: 'Current', matches: isCurrent },
		mine: {
			label: 'Mine',
			matches: (client: Client) =>
				client.partner?.id === header?.user.id ||
				client.manager?.id === header?.user.id ||
				client.entities.some((entity) => entity.engagement?.onTeam)
		},
		dueSoon: {
			label: 'Accounts due soon',
			matches: (client: Client) => isCurrent(client) && !!deadlineWarning(client.nextAccountsDue)
		},
		reviewDue: {
			label: 'Review due',
			matches: (client: Client) => isCurrent(client) && isReviewDue(client.lastReviewedOn)
		},
		highRisk: {
			label: 'High risk',
			matches: (client: Client) => isCurrent(client) && client.riskRating === 'high'
		},
		noPartner: {
			label: 'No partner',
			matches: (client: Client) => isCurrent(client) && !client.partner
		},
		prospect: { label: 'Prospects', matches: (client: Client) => client.status === 'prospect' },
		former: { label: 'Former', matches: (client: Client) => client.status === 'former' }
	};
	type View = keyof typeof views;
	// Shown even when empty; the rest only when they have clients in them.
	const alwaysShown: View[] = ['current', 'mine'];
	// Members only see their own clients, so attention views are for owners and admins.
	const managerOnly: View[] = ['reviewDue', 'highRisk', 'noPartner', 'prospect', 'former'];
	let view = $state<View>('current');
	let text = $state('');

	const viewOptions = $derived(
		(Object.keys(views) as View[])
			.filter((key) => workspace.canManage || !managerOnly.includes(key))
			.map((key) => ({
				value: key,
				label: views[key].label,
				count: directory.filter(views[key].matches).length
			}))
			.filter((option) => alwaysShown.includes(option.value) || option.count > 0)
	);
	function matchesText(client: Client) {
		const wanted = text.trim().toLowerCase();
		const searchable = [
			client.name,
			client.keyContact?.name,
			...client.entities.flatMap((entity) => [entity.name, entity.companyNumber])
		];
		return searchable.some((value) => value?.toLowerCase().includes(wanted));
	}
	const byDeadline = (a: Client, b: Client) =>
		(a.nextAccountsDue ?? '9999').localeCompare(b.nextAccountsDue ?? '9999');
	const matching = $derived(directory.filter((c) => views[view].matches(c) && matchesText(c)));
	// The list arrives sorted by name; the deadline view puts the soonest first.
	const shown = $derived(view === 'dueSoon' ? matching.toSorted(byDeadline) : matching);

	/** "Year end 31 Dec", or every distinct year end when the entities differ. */
	function yearEnds(client: Client) {
		const dates = [
			...new Set(
				client.entities.flatMap(
					(entity) => formatYearEnd(entity.yearEndDay, entity.yearEndMonth) ?? []
				)
			)
		];
		if (dates.length === 0) return null;
		return `${dates.length === 1 ? 'Year end' : 'Year ends'} ${dates.join(', ')}`;
	}

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
	<div class="filters">
		<FilterChips label="Show" options={viewOptions} bind:value={view} />
		<label class="filter-search"
			><span class="visually-hidden">Find a client</span><input
				type="search"
				bind:value={text}
				placeholder="Find a client, entity or contact"
			/></label
		>
	</div>

	<div class="table-scroll">
		<table class="client-table">
			<thead>
				<tr>
					<th scope="col">Client</th>
					<th scope="col">Next accounts due</th>
					<th scope="col" class="desktop-context">Partner and manager</th>
					<th scope="col" class="desktop-context">Key contact</th>
				</tr>
			</thead>
			<tbody>
				{#each shown as client (client.id)}
					{@const warning = deadlineWarning(client.nextAccountsDue)}
					{@const summary = yearEnds(client)}
					<tr>
						<td>
							<a class="primary-link" href={`${base}/clients/${client.id}`}>{client.name}</a>
							{#if client.status !== 'active'}<span class="badge"
									>{CLIENT_STATUSES[client.status]}</span
								>{/if}
							{#if client.riskRating === 'high'}<span class="badge warning">High risk</span>{/if}
							{#if workspace.canManage && isCurrent(client) && isReviewDue(client.lastReviewedOn)}<span
									class="badge warning">Review due</span
								>{/if}
							<span class="cell-detail"
								>{client.entities.map((entity) => entity.name).join(', ') ||
									'No legal entities yet'}</span
							>
							{#if summary}<span class="cell-detail">{summary}</span>{/if}
						</td>
						<td class="nowrap">
							{client.nextAccountsDue ? formatDate(client.nextAccountsDue) : '—'}
							{#if warning}<span class="cell-detail" class:urgent={warning.urgent}
									>{warning.text}</span
								>{/if}
						</td>
						<td class="desktop-context">
							{#if client.partner}{client.partner.name}{:else}<span class="badge warning"
									>No partner</span
								>{/if}
							{#if client.manager}<span class="cell-detail">{client.manager.name}</span>{/if}
						</td>
						<td class="desktop-context">
							{#if client.keyContact}
								{client.keyContact.name}
								{#if client.keyContact.email}<a
										class="cell-detail"
										href={`mailto:${client.keyContact.email}`}>{client.keyContact.email}</a
									>{/if}
								{#if client.keyContact.phone}<span class="cell-detail"
										>{client.keyContact.phone}</span
									>{/if}
							{:else}<span class="muted">Not chosen</span>{/if}
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
