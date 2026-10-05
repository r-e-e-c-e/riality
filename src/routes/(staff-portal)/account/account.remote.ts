import { form, getRequestEvent, query } from '$app/server';
import { redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { identity, mfa } from '#server/app.js';
import {
	NEW_PASSWORD_FIELD,
	clearIdentity,
	deleteSessionCookie,
	requireIdentity,
	requireRecentSignIn,
	setSessionCookie,
	submit
} from '#server/request.js';
import {
	changePasswordSchema,
	mfaConfirmSchema,
	profileSchema,
	reauthenticateSchema
} from '#lib/schemas/identity.js';
import { getIdentity } from '#lib/remotes/auth.remote.js';
import { getHeader } from '#lib/remotes/workspace.remote.js';
import { idSchema } from '#lib/schemas/tenancy.js';

// Manage account uses requireIdentity / requireRecentSignIn (not requireUser), so
// users who still need to set up MFA can reach this page.

export const updateProfile = form(profileSchema, async (input) => {
	const { user } = requireIdentity();
	await submit(() => identity.updateProfile(user.id, input));
	// Show the new name and colour straight away, including in the header.
	getRequestEvent().locals.user = { ...user, ...input };
	await getIdentity().refresh();
	await getHeader().refresh();
	return { message: 'Profile saved.' };
});

export const getSessions = query(() => identity.listSessions(requireIdentity().user.id));

/** "Confirm it's you": allows sensitive changes for the next ten minutes. */
export const reauthenticate = form(reauthenticateSchema, async (input) => {
	const { user, session } = requireIdentity();
	const refreshed = await submit(() =>
		identity.reauthenticate(user.id, session.tokenHash, input._password, input._code)
	);
	setSessionCookie(refreshed.token, refreshed.session);
	getRequestEvent().locals.session = refreshed.session;
	return { message: 'Identity confirmed for the next ten minutes.' };
});

export const changePassword = form(changePasswordSchema, async (input) => {
	await submit(
		() =>
			identity.changePassword(requireRecentSignIn().user.id, {
				currentPassword: input._currentPassword,
				password: input._password,
				address: getRequestEvent().getClientAddress()
			}),
		{ ...NEW_PASSWORD_FIELD, CURRENT_PASSWORD_INCORRECT: '_currentPassword' }
	);
	clearIdentity();
	redirect(303, '/login?reset=1');
});

export const beginMfa = form(async () => {
	return submit(() => mfa.begin(requireRecentSignIn().user.id));
});

export const confirmMfa = form(mfaConfirmSchema, async (input) => {
	const codes = await submit(() => mfa.confirm(requireRecentSignIn().user.id, input._code), {
		AUTHENTICATOR_CODE_INCORRECT: '_code'
	});
	// All sessions were revoked. Delete the cookie, but keep this request's identity
	// so the page can refresh its data and show the recovery codes once.
	deleteSessionCookie();
	return { codes };
});

export const regenerateRecoveryCodes = form(reauthenticateSchema, async (input) => {
	const codes = await submit(() => {
		const { user, session } = requireRecentSignIn();
		return mfa.replaceRecoveryCodes(user.id, session.tokenHash, input._password, input._code);
	});
	deleteSessionCookie();
	return { codes };
});

export const disableMfa = form(reauthenticateSchema, async (input) => {
	const { user, session } = requireIdentity();
	await submit(() => mfa.disable(user.id, session.tokenHash, input._password, input._code));
	clearIdentity();
	redirect(303, '/login');
});

export const revokeSession = form(z.object({ sessionId: idSchema }), async (input) => {
	const { session } = await submit(async () => {
		const signedIn = requireRecentSignIn();
		await identity.revokeSession(signedIn.user.id, input.sessionId);
		return signedIn;
	});
	if (session.id === input.sessionId) {
		clearIdentity();
		redirect(303, '/login');
	}
	await getSessions().refresh();
	return { message: 'Session revoked.' };
});

export const exportAccount = form(async () => {
	return submit(() => identity.exportAccount(requireRecentSignIn().user.id));
});
