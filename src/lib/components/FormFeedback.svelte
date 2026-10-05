<script lang="ts">
	let { issues, message }: { issues?: readonly { message: string }[]; message?: string } = $props();
</script>

{#if issues?.length}
	<div class="feedback issue" role="alert">
		{#each issues as issue (issue)}<p>{issue.message}</p>{/each}
	</div>
{/if}
{#if message}<p class="feedback" role="status">{message}</p>{/if}
