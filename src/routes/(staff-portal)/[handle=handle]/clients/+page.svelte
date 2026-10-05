<script lang="ts">
	import { page } from '$app/state';
	import { getWorkspace } from '#lib/remotes/workspace.remote.js';
	import { createClient, createEntity, getClientDirectory } from '#lib/remotes/clients.remote.js';
	import FormFeedback from '#lib/components/FormFeedback.svelte';
	const workspace = $derived(await getWorkspace(page.params.handle ?? ''));
	const directory = $derived(await getClientDirectory(workspace.firm.id));
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
							{#each client.entities as entity (entity.id)}<li>{entity.name}</li>{/each}
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
				<label
					>Legal entity name<input
						{...createEntity.fields.name.as('text')}
						required
						maxlength="160"
					/></label
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
