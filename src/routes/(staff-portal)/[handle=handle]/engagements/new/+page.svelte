<script lang="ts">
	import { page } from '$app/state';
	import { getWorkspace } from '#lib/remotes/workspace.remote.js';
	import {
		getClients,
		getEntities,
		createClient,
		createEntity
	} from '#lib/remotes/clients.remote.js';
	import { createEngagement } from './new-engagement.remote';
	import FormFeedback from '#lib/components/FormFeedback.svelte';
	import { isFirmRecordChange, refreshOn } from '#lib/live-updates.svelte.js';
	const workspace = $derived(await getWorkspace(page.params.handle ?? ''));
	const firmId = $derived(workspace.firm.id);
	const clients = $derived(await getClients(firmId));
	const entities = $derived(await getEntities(firmId));
	refreshOn(
		(change) => isFirmRecordChange(change, firmId),
		() => Promise.all([getClients(firmId).refresh(), getEntities(firmId).refresh()])
	);
	// One instance of each form on this page, so no .for(key): keyed forms lose errors without JavaScript.
	const clientForm = createClient;
	const entityForm = createEntity;
	const engagementForm = createEngagement;
</script>

<svelte:head><title>New engagement · {workspace.firm.name}</title></svelte:head>

<div class="narrow">
	<div class="page-heading">
		<div>
			<h1>New engagement</h1>
			<p class="muted">Set up a statutory audit, then assign its team.</p>
		</div>
	</div>
	{#if entities.length}
		<section class="panel">
			<form {...engagementForm}>
				<input {...engagementForm.fields.firmId.as('hidden', firmId)} />
				<label
					>Entity<select
						{...engagementForm.fields.entityId.as(
							'select',
							entities.length === 1 ? entities[0].id : ''
						)}
						required
						><option value="">Choose an entity</option>{#each entities as entity (entity.id)}<option
								value={entity.id}>{entity.clientName} · {entity.name}</option
							>{/each}</select
					></label
				>
				<div class="field-pair">
					<label
						>Period start<input {...engagementForm.fields.periodStart.as('date')} required /></label
					><label
						>Period end<input {...engagementForm.fields.periodEnd.as('date')} required /></label
					>
				</div>
				<p class="muted">
					You will join the team as manager. You can change team responsibilities after creation.
				</p>
				<FormFeedback issues={engagementForm.fields.allIssues()} />
				<div class="form-actions">
					<button type="submit" disabled={!!engagementForm.pending}>Create engagement</button><a
						href={`/${workspace.firm.handle}/engagements`}>Cancel</a
					>
				</div>
			</form>
		</section>
	{:else}<p class="notice">Start by adding the client and legal entity you’re auditing.</p>{/if}
	<details
		class="panel disclosure"
		open={!entities.length ||
			!!clientForm.fields.allIssues()?.length ||
			!!entityForm.fields.allIssues()?.length}
	>
		<summary>Add a client or legal entity</summary>
		<p class="muted">Use an existing client when the firm already has a relationship with them.</p>
		<details open={!clients.length || !!clientForm.fields.allIssues()?.length}>
			<summary>Create a client</summary>
			<form {...clientForm}>
				<input {...clientForm.fields.firmId.as('hidden', firmId)} />
				<label
					>Client name<input
						{...clientForm.fields.name.as('text')}
						required
						maxlength="160"
					/></label
				>
				<FormFeedback issues={clientForm.fields.allIssues()} message={clientForm.result?.message} />
				<button class="secondary" type="submit" disabled={!!clientForm.pending}
					>Create client</button
				>
			</form>
		</details>
		{#if clients.length}
			<h2>Add a legal entity</h2>
			<form {...entityForm}>
				<input {...entityForm.fields.firmId.as('hidden', firmId)} />
				<label
					>Client<select
						{...entityForm.fields.clientId.as('select', clients.length === 1 ? clients[0].id : '')}
						required
						><option value="">Choose a client</option>{#each clients as client (client.id)}<option
								value={client.id}>{client.name}</option
							>{/each}</select
					></label
				>
				<label
					>Legal entity name<input
						{...entityForm.fields.name.as('text')}
						required
						maxlength="160"
					/></label
				>
				<FormFeedback issues={entityForm.fields.allIssues()} message={entityForm.result?.message} />
				<button class="secondary" type="submit" disabled={!!entityForm.pending}>Add entity</button>
			</form>
		{/if}
	</details>
</div>
