<script lang="ts">
	import type { getFirmEngagements } from '#lib/remotes/engagements.remote.js';
	import { deadlineWarning } from '#lib/clients.js';
	import { formatDate, teamRoleLabels } from '#lib/format.js';

	// A queue of engagements: what the work is, when it is due and who is doing it.
	// Owners and admins (canManage) also get a link to each team.
	let {
		engagements,
		canManage = false
	}: {
		engagements: Awaited<ReturnType<typeof getFirmEngagements>>;
		canManage?: boolean;
	} = $props();

	type Engagement = (typeof engagements)[number];
	const memberWith = (engagement: Engagement, role: 'partner' | 'manager') =>
		engagement.team.find((member) => member.role === role);
</script>

<div class="table-scroll">
	<table class="client-table">
		<thead>
			<tr>
				<th scope="col">Engagement</th>
				<th scope="col">Year end</th>
				<th scope="col">Accounts due</th>
				<th scope="col" class="desktop-context">Team</th>
				<th scope="col" class="desktop-context">Stage</th>
				{#if canManage}<th scope="col" class="desktop-context"
						><span class="visually-hidden">Team changes</span></th
					>{/if}
			</tr>
		</thead>
		<tbody>
			{#each engagements as engagement (engagement.id)}
				{@const partner = memberWith(engagement, 'partner')}
				{@const manager = memberWith(engagement, 'manager')}
				{@const others = engagement.team.length - (partner ? 1 : 0) - (manager ? 1 : 0)}
				{@const warning = deadlineWarning(engagement.accountsDueOn)}
				<tr>
					<td>
						<a
							class="primary-link"
							href={`/${engagement.firmHandle}/engagements/${engagement.id}${engagement.myRole ? '' : '/team'}`}
							>{engagement.entityName}</a
						>
						<span class="cell-detail"
							>{[
								engagement.clientName,
								engagement.myRole && `You: ${teamRoleLabels[engagement.myRole]}`
							]
								.filter(Boolean)
								.join(' · ')}</span
						>
					</td>
					<td class="nowrap">{formatDate(engagement.periodEnd)}</td>
					<td class="nowrap">
						{formatDate(engagement.accountsDueOn)}
						{#if warning}<span class="cell-detail" class:urgent={warning.urgent}
								>{warning.text}</span
							>{/if}
					</td>
					<td class="desktop-context">
						{#if engagement.team.length === 0}
							<span class="badge warning">No team yet</span>
						{:else}
							{#if partner}{partner.name}{:else}<span class="badge warning">No partner</span>{/if}
							<span class="cell-detail"
								>{[manager?.name ?? 'No manager', others > 0 && `${others} more`]
									.filter(Boolean)
									.join(' · ')}</span
							>
						{/if}
					</td>
					<td class="desktop-context"><span class="badge">Setup</span></td>
					{#if canManage}<td class="desktop-context"
							><a href={`/${engagement.firmHandle}/engagements/${engagement.id}/team`}
								>{engagement.team.length ? 'Manage team' : 'Assign team'}</a
							></td
						>{/if}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
