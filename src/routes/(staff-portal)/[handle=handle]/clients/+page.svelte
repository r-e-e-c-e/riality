<script lang="ts">
	import { page } from '$app/state';
	import { getWorkspace } from '#lib/remotes/workspace.remote.js';
	import {
		createClient,
		createEntity,
		getClientDirectory,
		getCompaniesHouseEnabled,
		searchCompanies
	} from '#lib/remotes/clients.remote.js';
	import FormFeedback from '#lib/components/FormFeedback.svelte';
	import { COMPANY_STATUSES, ENTITY_TYPES, keysOf } from '#lib/companies.js';
	const workspace = $derived(await getWorkspace(page.params.handle ?? ''));
	const directory = $derived(await getClientDirectory(workspace.firm.id));
	const companiesHouseEnabled = $derived(await getCompaniesHouseEnabled());

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
				? 'Clients and the legal entities you audit for them.'
				: 'Clients of the engagements you are assigned to.'}
		</p>
	</div>
</div>

{#if directory.length}
	<section class="panel roster" aria-label="Clients">
		{#each directory as client (client.id)}
			<div class="roster-row">
				<div>
					<h2>{client.name}</h2>
					{#if client.entities.length}
						<ul class="muted">
							{#each client.entities as entity (entity.id)}<li>
									<a href={`/${workspace.firm.handle}/entities/${entity.id}`}>{entity.name}</a>
									{#if entity.companyNumber}· {entity.companyNumber}{/if}
									{#if entity.companyStatus && entity.companyStatus !== 'active'}·
										{COMPANY_STATUSES[entity.companyStatus]}{/if}
								</li>{/each}
						</ul>
					{:else}<p class="muted">No legal entities yet.</p>{/if}
				</div>
			</div>
		{/each}
	</section>
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
