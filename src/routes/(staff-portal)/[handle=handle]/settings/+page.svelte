<script lang="ts">
	import { page } from '$app/state';
	import { getWorkspace } from '#lib/remotes/workspace.remote.js';
	import {
		getInvitations,
		getMembers,
		inviteMember,
		revokeInvitation,
		updateFirm,
		updateMembership
	} from './settings.remote';
	import Avatar from '#lib/components/Avatar.svelte';
	import FormFeedback from '#lib/components/FormFeedback.svelte';
	import { formatDate } from '#lib/format.js';

	const workspace = $derived(await getWorkspace(page.params.handle ?? ''));
	const firm = $derived(workspace.firm);
	const isOwner = $derived(workspace.role === 'owner');
	const members = $derived(await getMembers(firm.id));
	const invites = $derived(await getInvitations(firm.id));
	// One instance of these forms per page, so no .for(key): keyed forms lose errors without JavaScript.
	const invite = inviteMember;
	const roleLabels = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const;
</script>

<svelte:head><title>Settings · {firm.name}</title></svelte:head>

<div class="page-heading">
	<div>
		<h1>Settings</h1>
		<p class="muted">Manage who can use {firm.name}, and the firm's details.</p>
	</div>
</div>

<h2>Team</h2>
<p class="muted">
	Members can use the workspace. Admins can also manage clients, engagements and the team. Owners
	can also manage owners and the firm's details. Engagement access is assigned per engagement.
</p>
<section class="panel roster" aria-label="Team members">
	{#each members as member (member.userId)}
		{@const update = updateMembership.for(`${firm.id}:${member.userId}`)}
		{@const canChange = isOwner || member.role !== 'owner'}
		<div class="roster-row">
			<div class="member">
				<Avatar name={member.name} color={member.avatarColor} />
				<div>
					<h3>{member.name}</h3>
					<p class="muted">{member.email}</p>
					<span class="badge">{roleLabels[member.role]}</span>
				</div>
			</div>
			{#if canChange}
				<details open={!!update.fields.allIssues()?.length}>
					<summary aria-label={`Change access for ${member.name}`}>Change access</summary>
					<form {...update}>
						<input {...update.fields.tenantId.as('hidden', firm.id)} />
						<input {...update.fields.userId.as('hidden', member.userId)} />
						<input {...update.fields.handle.as('hidden', firm.handle)} />
						<label
							>Access for {member.name}<select {...update.fields.role.as('select', member.role)}
								><option value="member">Member</option><option value="admin">Admin</option
								>{#if isOwner}<option value="owner">Owner</option>{/if}<option value="remove"
									>Remove from firm</option
								></select
							></label
						>
						<FormFeedback issues={update.fields.allIssues()} message={update.result?.message} />
						<button class="secondary" type="submit" disabled={!!update.pending}
							>Update access</button
						>
					</form>
				</details>
			{/if}
		</div>
	{/each}
</section>

<details class="panel disclosure" open={!!invite.fields.allIssues()?.length || !!invite.result}>
	<summary>Invite someone</summary>
	<form {...invite}>
		<input {...invite.fields.tenantId.as('hidden', firm.id)} />
		<label>Email<input {...invite.fields.email.as('email')} required maxlength="254" /></label>
		<label
			>Access<select {...invite.fields.role.as('select', 'member')}
				><option value="member">Member</option><option value="admin">Admin</option
				>{#if isOwner}<option value="owner">Owner</option>{/if}</select
			></label
		>
		<FormFeedback issues={invite.fields.allIssues()} message={invite.result?.message} />
		<button type="submit" disabled={!!invite.pending}>Send invitation</button>
	</form>
</details>

<details class="panel disclosure">
	<summary>Pending invitations ({invites.length})</summary>
	{#each invites as invitation (invitation.id)}
		{@const revoke = revokeInvitation.for(invitation.id)}
		<div class="roster-row">
			<div>
				<p>{invitation.email}</p>
				<p class="muted">
					{roleLabels[invitation.role]} · Expires {formatDate(invitation.expiresAt)}
				</p>
			</div>
			{#if isOwner || invitation.role !== 'owner'}
				<form {...revoke}>
					<input {...revoke.fields.tenantId.as('hidden', firm.id)} /><input
						{...revoke.fields.invitationId.as('hidden', invitation.id)}
					/><FormFeedback issues={revoke.fields.allIssues()} /><button
						class="secondary"
						type="submit"
						disabled={!!revoke.pending}>Revoke</button
					>
				</form>
			{/if}
		</div>
	{:else}<p class="muted">No pending invitations.</p>{/each}
</details>

<h2 class="section-gap">Firm</h2>
<section class="panel">
	{#if isOwner}
		<form {...updateFirm}>
			<input {...updateFirm.fields.firmId.as('hidden', firm.id)} />
			<label
				>Firm name<input
					{...updateFirm.fields.name.as('text', firm.name)}
					required
					maxlength="160"
				/></label
			>
			<label
				>Web address
				<span class="muted"
					>lines.ws/{firm.handle}. Changing it changes every link to the firm; old links stop
					working.</span
				>
				<input
					{...updateFirm.fields.handle.as('text', firm.handle)}
					required
					maxlength="40"
					autocapitalize="off"
					spellcheck="false"
				/></label
			>
			<FormFeedback issues={updateFirm.fields.allIssues()} />
			<button type="submit" disabled={!!updateFirm.pending}>Save firm details</button>
		</form>
	{:else}
		<p><strong>{firm.name}</strong></p>
		<p class="muted">lines.ws/{firm.handle} · Only owners can change the firm's details.</p>
	{/if}
</section>

<p class="secondary-navigation">
	<a href="/account">Confirm your identity</a><span class="muted"
		>Team and firm changes need your password within the last ten minutes.</span
	>
</p>
