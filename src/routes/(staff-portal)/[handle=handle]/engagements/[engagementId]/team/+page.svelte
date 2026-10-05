<script lang="ts">
	import { page } from '$app/state';
	import { getWorkspace } from '#lib/remotes/workspace.remote.js';
	import { getTeamSetup, updateAssignment } from './team.remote';
	import FormFeedback from '#lib/components/FormFeedback.svelte';
	import { formatDate, teamRoleLabels } from '#lib/format.js';
	import { refreshOn } from '#lib/live-updates.svelte.js';
	const workspace = $derived(await getWorkspace(page.params.handle ?? ''));
	const scope = $derived({
		firmId: workspace.firm.id,
		engagementId: page.params.engagementId ?? ''
	});
	const setup = $derived(await getTeamSetup(scope));
	refreshOn(
		(change) =>
			change.engagementId === scope.engagementId ||
			(change.tenantId === scope.firmId && change.action.startsWith('membership.')),
		() => getTeamSetup(scope).refresh()
	);
	const assigned = $derived(setup.members.filter((member) => member.role));
	const available = $derived(setup.members.filter((member) => !member.role));
	const add = $derived(updateAssignment.for(`${scope.engagementId}:add`));
</script>

<svelte:head
	><title>Team · {setup.engagement.entityName} · {workspace.firm.name}</title></svelte:head
>
<div class="page-heading">
	<div>
		<p class="eyebrow">{setup.engagement.entityName}</p>
		<h1>Engagement team</h1>
		<p class="muted">
			{formatDate(setup.engagement.periodStart)} – {formatDate(setup.engagement.periodEnd)}
		</p>
	</div>
	{#if setup.engagement.myRole}<a
			class="button secondary"
			href={`/${workspace.firm.handle}/engagements/${scope.engagementId}`}>Open engagement</a
		>{/if}
</div>
<p class="muted">Team members need both firm membership and an engagement assignment.</p>
<p class="visually-hidden" role="status">{assigned.length} team members assigned.</p>
<section class="panel roster" aria-label="Assigned team">
	{#each assigned as member (member.userId)}
		{@const assignment = updateAssignment.for(`${scope.engagementId}:${member.userId}`)}
		<div class="roster-row">
			<div>
				<h2>{member.name}</h2>
				<p class="muted">{member.email}</p>
				<span class="badge">{member.role ? teamRoleLabels[member.role] : ''}</span>
				{#if member.isResponsibleIndividual}<span class="badge">Responsible Individual</span>{/if}
			</div>
			<details open={!!assignment.fields.allIssues()?.length || !!assignment.result}>
				<summary aria-label={`Change role for ${member.name}`}>Change role</summary>
				<form {...assignment}>
					<input {...assignment.fields.firmId.as('hidden', scope.firmId)} /><input
						{...assignment.fields.engagementId.as('hidden', scope.engagementId)}
					/><input {...assignment.fields.userId.as('hidden', member.userId)} />
					<label
						>Team role for {member.name}<select
							{...assignment.fields.role.as('select', member.role ?? 'auditor')}
							><option value="auditor">Auditor</option><option value="manager">Manager</option
							><option value="partner" disabled={!member.isResponsibleIndividual}
								>Partner{member.isResponsibleIndividual
									? ''
									: ' (Responsible Individuals only)'}</option
							><option value="remove">Remove from team</option></select
						></label
					>
					<FormFeedback
						issues={assignment.fields.allIssues()}
						message={assignment.result?.message}
					/>
					<button class="secondary" type="submit" disabled={!!assignment.pending}
						>Save role for {member.name}</button
					>
				</form>
			</details>
		</div>
	{:else}<div class="empty-state">
			<h2>No team assigned</h2>
			<p>Add a firm member to give them access to this engagement.</p>
		</div>{/each}
</section>
<FormFeedback message={add.result?.message} />
{#if available.length}
	<details class="panel disclosure" open={!assigned.length || !!add.fields.allIssues()?.length}>
		<summary>Add a team member</summary>
		<form {...add}>
			<input {...add.fields.firmId.as('hidden', scope.firmId)} /><input
				{...add.fields.engagementId.as('hidden', scope.engagementId)}
			/>
			<label
				>Firm member<select {...add.fields.userId.as('select')} required
					><option value="">Choose a member</option
					>{#each available as member (member.userId)}<option value={member.userId}
							>{member.name}{member.isResponsibleIndividual
								? ' (Responsible Individual)'
								: ''}</option
						>{/each}</select
				></label
			>
			<label
				>Team role<select {...add.fields.role.as('select', 'auditor')}
					><option value="auditor">Auditor</option><option value="manager">Manager</option><option
						value="partner">Partner</option
					></select
				></label
			>
			<p class="muted">The partner must be a Responsible Individual.</p>
			<FormFeedback issues={add.fields.allIssues()} />
			<button type="submit" disabled={!!add.pending}>Add to team</button>
		</form>
	</details>
{/if}
<p class="secondary-navigation">
	<a href="/account">Confirm your identity</a><span class="muted"
		>Required for team changes after ten minutes.</span
	>
</p>
