import { form, getRequestEvent } from '$app/server';
import { redirect } from '@sveltejs/kit';
import { config, identity } from '#server/app.js';
import { SESSION_COOKIE, safeReturnPath, setSessionCookie, submit } from '#server/request.js';
import { loginSchema } from '#lib/schemas/identity.js';

export const login = form(loginSchema, async (input) => {
	const event = getRequestEvent();
	const result = await submit(() =>
		identity.login({
			email: input.email,
			password: input._password,
			code: input._code,
			address: event.getClientAddress(),
			previousToken: event.cookies.get(SESSION_COOKIE)
		})
	);
	setSessionCookie(result.token, result.session);
	event.locals.user = result.user;
	event.locals.session = result.session;
	const mustSetUpMfa = config.requireMfa && !result.user.mfaEnabled;
	redirect(303, mustSetUpMfa ? '/account' : safeReturnPath(input.next));
});
