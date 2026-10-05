<script lang="ts">
	import type { getFirmEngagements } from '#lib/remotes/engagements.remote.js';
	import { formatDate, teamRoleLabels } from '#lib/format.js';
	let {
		engagements,
		showFirm = false,
		canManage = false
	}: {
		engagements: Awaited<ReturnType<typeof getFirmEngagements>>;
		showFirm?: boolean;
		canManage?: boolean;
	} = $props();
</script>

<div class="table-scroll">
	<table>
		<thead
			><tr
				><th>Engagement</th>{#if showFirm}<th class="desktop-context">Firm</th>{/if}<th>Year end</th
				><th class="desktop-context">Your role</th><th class="desktop-context">Status</th
				>{#if canManage}<th class="desktop-context"><span class="visually-hidden">Team</span></th
					>{/if}</tr
			></thead
		>
		<tbody>
			{#each engagements as engagement (engagement.id)}
				<tr>
					<td>
						<a
							class="primary-link"
							href={`/${engagement.firmHandle}/engagements/${engagement.id}${engagement.myRole ? '' : '/team'}`}
							>{engagement.entityName}</a
						>
						<span class="cell-detail">{engagement.clientName}</span>
						{#if showFirm}<span class="mobile-context cell-detail">{engagement.firmName}</span>{/if}
						<span class="mobile-context cell-detail"
							>{engagement.myRole ? teamRoleLabels[engagement.myRole] : 'Unassigned'} · Setup</span
						>
					</td>
					{#if showFirm}<td class="desktop-context"
							><a href={`/${engagement.firmHandle}`}>{engagement.firmName}</a></td
						>{/if}
					<td class="nowrap">{formatDate(engagement.periodEnd)}</td>
					<td class="desktop-context"
						>{engagement.myRole ? teamRoleLabels[engagement.myRole] : 'Unassigned'}</td
					>
					<td class="desktop-context"><span class="badge">Setup</span></td>
					{#if canManage}<td class="desktop-context"
							><a href={`/${engagement.firmHandle}/engagements/${engagement.id}/team`}
								>{engagement.myRole ? 'Manage team' : 'Assign team'}</a
							></td
						>{/if}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
