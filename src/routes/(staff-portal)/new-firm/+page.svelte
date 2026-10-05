<script lang="ts">
	import { createFirm } from './new-firm.remote';
	import FormFeedback from '#lib/components/FormFeedback.svelte';
</script>

<svelte:head><title>Create a firm</title></svelte:head>

<main class="workspace narrow">
	<h1>Create a firm</h1>
	<p class="muted">Your firm holds its own clients, engagements and team.</p>
	<section class="panel">
		<form {...createFirm}>
			<label
				>Firm name<input {...createFirm.fields.name.as('text')} required maxlength="160" /></label
			>
			<label
				>Web address
				<span class="muted"
					>lines.ws/ followed by this handle. Leave empty to use the firm name.</span
				>
				<input
					{...createFirm.fields.handle.as('text')}
					maxlength="40"
					autocapitalize="off"
					spellcheck="false"
					placeholder="for-example-cedar-audit"
				/></label
			>
			<FormFeedback issues={createFirm.fields.allIssues()} />
			<div class="form-actions">
				<button type="submit" disabled={!!createFirm.pending}>Create firm</button><a href="/"
					>Cancel</a
				>
			</div>
		</form>
	</section>
</main>
