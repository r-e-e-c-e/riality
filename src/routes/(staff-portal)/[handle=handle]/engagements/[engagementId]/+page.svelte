<script lang="ts">
	import { page } from '$app/state';
	import { getEngagement } from './engagement.remote';
	import { getWorkspace } from '#lib/remotes/workspace.remote.js';
	import { formatDate, teamRoleLabels } from '#lib/format.js';
	import { refreshOn } from '#lib/live-updates.svelte.js';
	const workspace = $derived(await getWorkspace(page.params.handle ?? ''));
	const scope = $derived({
		firmId: workspace.firm.id,
		engagementId: page.params.engagementId ?? ''
	});
	const engagement = $derived(await getEngagement(scope));
	refreshOn(
		(change) =>
			change.engagementId === scope.engagementId ||
			(change.targetType === 'entity' && change.targetId === engagement.entityId),
		() => getEngagement(scope).refresh()
	);
</script>

<svelte:head><title>{engagement.entityName} · {workspace.firm.name}</title></svelte:head>
<div class="page-heading">
	<div>
		<p class="eyebrow">Statutory audit · {engagement.clientName}</p>
		<h1>{engagement.entityName}</h1>
		<p class="muted">{formatDate(engagement.periodStart)} – {formatDate(engagement.periodEnd)}</p>
	</div>
	<span class="badge">Setup</span>
</div>
<div class="overview-grid">
	<section class="panel">
		<h2>Engagement setup</h2>
		<p>Confirm the reporting period and team before audit work starts.</p>
		<dl class="facts">
			<div>
				<dt>Reporting period</dt>
				<dd>{formatDate(engagement.periodStart)} – {formatDate(engagement.periodEnd)}</dd>
			</div>
			<div>
				<dt>Your team role</dt>
				<dd>{engagement.myRole ? teamRoleLabels[engagement.myRole] : ''}</dd>
			</div>
		</dl>
	</section>
	<section class="panel">
		<div class="section-heading">
			<h2>Team</h2>
			{#if workspace.canManage}<a
					href={`/${workspace.firm.handle}/engagements/${scope.engagementId}/team`}>Manage team</a
				>{/if}
		</div>
		<ul class="team-list">
			{#each engagement.team as member (member.userId)}<li>
					<span>{member.name}</span><span class="muted">{teamRoleLabels[member.role]}</span>
				</li>{/each}
		</ul>
	</section>
</div>
