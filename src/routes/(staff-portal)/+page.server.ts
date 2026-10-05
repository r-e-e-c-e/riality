import { redirect } from '@sveltejs/kit';
import { tenancy } from '#server/app.js';
import { isMfaPending } from '#server/request.js';
import type { PageServerLoad } from './$types';

// lines.ws/ has no page of its own: it sends people to the right place. This is a
// server load (not a remote function) because it only redirects, before rendering.
export const load: PageServerLoad = async ({ locals }) => {
	const { user, session } = locals;
	if (!user || !session) redirect(303, '/login');
	if (isMfaPending(user, session)) redirect(303, '/account');
	const handle = await tenancy.findHomeFirmHandle(user);
	redirect(303, handle ? `/${handle}` : '/welcome');
};
