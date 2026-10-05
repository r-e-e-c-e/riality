<script lang="ts">
	import { page } from '$app/state';
	import { getWorkspace } from '#lib/remotes/workspace.remote.js';
	import { getCompaniesHouseEnabled } from '#lib/remotes/clients.remote.js';
	import { getEntity, refreshEntity, updateEntity } from './entity.remote';
	import FormFeedback from '#lib/components/FormFeedback.svelte';
	import {
		ACCOUNTING_FRAMEWORKS,
		COMPANY_STATUSES,
		ENTITY_TYPES,
		SIZE_CLASSES,
		keysOf
	} from '#lib/companies.js';
	import { formatDate } from '#lib/format.js';

	const workspace = $derived(await getWorkspace(page.params.handle ?? ''));
	const scope = $derived({ firmId: workspace.firm.id, entityId: page.params.entityId ?? '' });
	const entity = $derived(await getEntity(scope));
	const companiesHouseEnabled = $derived(await getCompaniesHouseEnabled());
	const months = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];
	const yearEnd = $derived(
		entity.yearEndDay && entity.yearEndMonth
			? `${entity.yearEndDay} ${months[entity.yearEndMonth - 1]}`
			: 'Not set'
	);
</script>

<svelte:head><title>{entity.name} · {workspace.firm.name}</title></svelte:head>

<div class="page-heading">
	<div>
		<p class="eyebrow">{entity.clientName}</p>
		<h1>{entity.name}</h1>
		<p class="muted">{ENTITY_TYPES[entity.entityType]}</p>
	</div>
</div>

<section class="panel">
	<h2>Register details</h2>
	<dl class="details">
		<dt>Company number</dt>
		<dd>{entity.companyNumber ?? 'Not registered'}</dd>
		<dt>Status</dt>
		<dd>{entity.companyStatus ? COMPANY_STATUSES[entity.companyStatus] : 'Unknown'}</dd>
		<dt>Incorporated</dt>
		<dd>{entity.incorporatedOn ? formatDate(entity.incorporatedOn) : 'Unknown'}</dd>
		<dt>Registered office</dt>
		<dd class="pre-line">{entity.registeredOffice ?? 'Unknown'}</dd>
		<dt>SIC codes</dt>
		<dd>{entity.sicCodes.length ? entity.sicCodes.join(', ') : 'None'}</dd>
		<dt>Year end</dt>
		<dd>{yearEnd}</dd>
		<dt>Last accounts made up to</dt>
		<dd>{entity.lastAccountsMadeUpTo ? formatDate(entity.lastAccountsMadeUpTo) : 'Unknown'}</dd>
		<dt>Next accounts due</dt>
		<dd>{entity.accountsNextDueOn ? formatDate(entity.accountsNextDueOn) : 'Unknown'}</dd>
		<dt>Accounting framework</dt>
		<dd>
			{entity.accountingFramework ? ACCOUNTING_FRAMEWORKS[entity.accountingFramework] : 'Not set'}
		</dd>
		<dt>Size</dt>
		<dd>{entity.sizeClass ? SIZE_CLASSES[entity.sizeClass] : 'Not set'}</dd>
	</dl>
	{#if entity.companiesHouseSyncedAt}
		<p class="muted">
			Last updated from Companies House {formatDate(entity.companiesHouseSyncedAt)}.
		</p>
	{/if}
	{#if workspace.canManage && companiesHouseEnabled && entity.companyNumber}
		<form {...refreshEntity}>
			<input {...refreshEntity.fields.firmId.as('hidden', scope.firmId)} />
			<input {...refreshEntity.fields.entityId.as('hidden', scope.entityId)} />
			<FormFeedback
				issues={refreshEntity.fields.allIssues()}
				message={refreshEntity.result?.message}
			/>
			<button class="secondary" type="submit" disabled={!!refreshEntity.pending}
				>Update from Companies House</button
			>
		</form>
	{/if}
</section>

{#if workspace.canManage}
	<details class="panel disclosure" open={!!updateEntity.fields.allIssues()?.length}>
		<summary>Edit details</summary>
		<form {...updateEntity}>
			<input {...updateEntity.fields.firmId.as('hidden', scope.firmId)} />
			<input {...updateEntity.fields.entityId.as('hidden', scope.entityId)} />
			<label
				>Name<input
					{...updateEntity.fields.name.as('text', entity.name)}
					required
					maxlength="160"
				/></label
			>
			<label
				>Type<select {...updateEntity.fields.entityType.as('select', entity.entityType)}
					>{#each keysOf(ENTITY_TYPES) as type (type)}<option value={type}
							>{ENTITY_TYPES[type]}</option
						>{/each}</select
				></label
			>
			<label
				>Company number<input
					{...updateEntity.fields.companyNumber.as('text', entity.companyNumber ?? '')}
					maxlength="10"
				/></label
			>
			<label
				>Accounting framework<select
					{...updateEntity.fields.accountingFramework.as(
						'select',
						entity.accountingFramework ?? ''
					)}
					><option value="">Not set</option
					>{#each keysOf(ACCOUNTING_FRAMEWORKS) as framework (framework)}<option value={framework}
							>{ACCOUNTING_FRAMEWORKS[framework]}</option
						>{/each}</select
				></label
			>
			<label
				>Size<select {...updateEntity.fields.sizeClass.as('select', entity.sizeClass ?? '')}
					><option value="">Not set</option>{#each keysOf(SIZE_CLASSES) as size (size)}<option
							value={size}>{SIZE_CLASSES[size]}</option
						>{/each}</select
				></label
			>
			<div class="field-pair">
				<label
					>Year end day<input
						{...updateEntity.fields.yearEndDay.as('text', String(entity.yearEndDay ?? ''))}
						inputmode="numeric"
						maxlength="2"
					/></label
				><label
					>Year end month<select
						{...updateEntity.fields.yearEndMonth.as('select', String(entity.yearEndMonth ?? ''))}
						><option value="">Not set</option>{#each months as month, index (month)}<option
								value={String(index + 1)}>{month}</option
							>{/each}</select
					></label
				>
			</div>
			<FormFeedback
				issues={updateEntity.fields.allIssues()}
				message={updateEntity.result?.message}
			/>
			<button type="submit" disabled={!!updateEntity.pending}>Save details</button>
		</form>
	</details>
{/if}
