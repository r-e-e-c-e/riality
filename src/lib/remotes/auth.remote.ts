import { form, getRequestEvent, query } from '$app/server';
import { redirect } from '@sveltejs/kit';
import { config, identity } from '#server/app.js';
import { clearIdentity } from '#server/request.js';

// Used by the header and several pages.

/** The signed-in user, or null. */
export const getIdentity = query(() => getRequestEvent().locals.user);

export const getAuthPolicy = query(() => ({
	requireMfa: config.requireMfa,
	signup: config.signup
}));

export const logout = form(async () => {
	const { session } = getRequestEvent().locals;
	if (session) await identity.logout(session.tokenHash);
	clearIdentity();
	redirect(303, '/login');
});
