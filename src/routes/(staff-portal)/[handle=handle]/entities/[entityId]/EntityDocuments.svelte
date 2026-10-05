<script lang="ts">
	import FormFeedback from '#lib/components/FormFeedback.svelte';
	import { keysOf } from '#lib/companies.js';
	import {
		ACCEPTED_EXTENSIONS,
		DOCUMENT_CATEGORIES,
		DOCUMENT_TYPES,
		documentTypeOf,
		formatFileSize
	} from '#lib/documents.js';
	import { formatDate } from '#lib/format.js';
	import { refreshOn } from '#lib/live-updates.svelte.js';
	import { getEntityDocuments, removeDocument, uploadDocument } from './entity.remote';

	// The entity's permanent file: documents every year's audit refers back to.
	// Everyone who can see the entity can download and upload; owners and admins remove.
	let {
		scope,
		handle,
		canManage
	}: { scope: { firmId: string; entityId: string }; handle: string; canManage: boolean } = $props();

	const permanentFile = $derived(await getEntityDocuments(scope));
	const sections = $derived(
		keysOf(DOCUMENT_CATEGORIES)
			.map((category) => ({
				category,
				documents: permanentFile.documents.filter((document) => document.category === category)
			}))
			.filter((section) => section.documents.length > 0)
	);
	refreshOn(
		(change) => change.targetType === 'entity' && change.targetId === scope.entityId,
		() => getEntityDocuments(scope).refresh()
	);

	const typeLabel = (fileName: string) => {
		const type = documentTypeOf(fileName);
		return type ? DOCUMENT_TYPES[type].label : 'File';
	};
</script>

<section class="panel" aria-labelledby="documents-heading">
	<h2 id="documents-heading">Permanent file</h2>
	{#if sections.length}
		{#each sections as section (section.category)}
			<h3 class="section-label">{DOCUMENT_CATEGORIES[section.category]}</h3>
			<ul class="document-list">
				{#each section.documents as document (document.id)}
					{@const remove = removeDocument.for(document.id)}
					<li>
						<div>
							<a href={`/${handle}/documents/${document.id}`} download>{document.title}</a>
							<span class="cell-detail"
								>{typeLabel(document.fileName)} · {formatFileSize(document.sizeBytes)} · Added {formatDate(
									document.uploadedAt
								)} by {document.uploadedBy}</span
							>
						</div>
						{#if canManage}
							<details>
								<summary aria-label={`Remove ${document.title}`}>Remove</summary>
								<form {...remove}>
									<input {...remove.fields.firmId.as('hidden', scope.firmId)} />
									<input {...remove.fields.documentId.as('hidden', document.id)} />
									<FormFeedback issues={remove.fields.allIssues()} />
									<button class="secondary" type="submit" disabled={!!remove.pending}
										>Remove from permanent file</button
									>
								</form>
							</details>
						{/if}
					</li>
				{/each}
			</ul>
		{/each}
	{:else}
		<p class="muted">
			No documents yet. Add the articles, ownership records, key agreements, loan and lease
			documents, and engagement letters.
		</p>
	{/if}
</section>

{#if permanentFile.canUpload}
	<details
		class="panel disclosure"
		open={!!uploadDocument.fields.allIssues()?.length || !!uploadDocument.result}
	>
		<summary>Upload a document</summary>
		<form {...uploadDocument} enctype="multipart/form-data">
			<input {...uploadDocument.fields.firmId.as('hidden', scope.firmId)} />
			<input {...uploadDocument.fields.entityId.as('hidden', scope.entityId)} />
			<label
				>File <span class="muted">(PDF, Word, Excel, CSV, Outlook email or image, up to 25 MB)</span
				><input
					{...uploadDocument.fields.file.as('file')}
					accept={ACCEPTED_EXTENSIONS}
					required
				/></label
			>
			<label
				>Section<select {...uploadDocument.fields.category.as('select', 'constitution')}
					>{#each keysOf(DOCUMENT_CATEGORIES) as category (category)}<option value={category}
							>{DOCUMENT_CATEGORIES[category]}</option
						>{/each}</select
				></label
			>
			<label
				>Title <span class="muted">(optional; the file name is used otherwise)</span><input
					{...uploadDocument.fields.title.as('text')}
					maxlength="200"
				/></label
			>
			<FormFeedback
				issues={uploadDocument.fields.allIssues()}
				message={uploadDocument.result?.message}
			/>
			<button type="submit" disabled={!!uploadDocument.pending}>Upload</button>
		</form>
	</details>
{/if}
