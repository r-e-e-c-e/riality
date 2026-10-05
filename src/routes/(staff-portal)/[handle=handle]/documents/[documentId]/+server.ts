import { documents, tenancy } from '#server/app.js';
import { requireUser } from '#server/request.js';
import type { RequestHandler } from './$types';

// Downloads a document. A plain endpoint rather than a remote function, because it
// streams a file. Always sent as an attachment, so the browser never runs or renders
// an uploaded file inside the app.

export const GET: RequestHandler = async ({ params }) => {
	const user = requireUser();
	const { firm } = await tenancy.getFirmByHandle(user, params.handle);
	const { document, contents } = await documents.open(user, {
		firmId: firm.id,
		documentId: params.documentId
	});
	const asciiName = document.fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
	return new Response(contents, {
		headers: {
			'content-type': document.contentType,
			'content-length': String(document.sizeBytes),
			'content-disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(document.fileName)}`
		}
	});
};
