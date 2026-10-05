import { building, dev } from '$app/env';
import { ZodError } from 'zod';
import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit/hooks';
import { config, identity, services } from '#server/app.js';
import { startBackgroundJobs } from '#server/jobs.js';
import { BusinessError } from '#server/errors.js';
import { describeError, logger } from '#server/logger.js';
import { runWithRequestContext } from '#server/request-context.js';
import { SESSION_COOKIE, deleteSessionCookie } from '#server/request.js';

export const init: ServerInit = () => {
	if (!building) startBackgroundJobs(services, config.mail);
};

export const handle: Handle = async ({ event, resolve }) => {
	const startedAt = performance.now();
	const requestId = Bun.randomUUIDv7();
	event.locals.requestId = requestId;
	event.locals.user = null;
	event.locals.session = null;

	if (!building) {
		const token = event.cookies.get(SESSION_COOKIE);
		const signedIn = await identity.authenticate(token);
		if (signedIn) {
			event.locals.user = signedIn.user;
			event.locals.session = signedIn.session;
		} else if (token) {
			deleteSessionCookie(event.cookies);
		}
	}

	const context = {
		requestId,
		userId: event.locals.user?.id,
		sessionId: event.locals.session?.id
	};
	const response = await runWithRequestContext(context, () => resolve(event));
	setSecurityHeaders(response.headers, event.url);
	response.headers.set('x-request-id', requestId);

	if (!dev) {
		logger.info('request', {
			method: event.request.method,
			route: event.route.id,
			status: response.status,
			durationMs: Math.round(performance.now() - startedAt),
			requestId,
			userId: context.userId
		});
	}
	return response;
};

/**
 * Every error thrown while handling a request ends up here (except redirects).
 * - Business errors (errors.ts) and invalid input are expected: send their status,
 *   message and code. They are not logged as errors.
 * - Remote-function arguments that fail their schema mean the request did not come
 *   from our forms, so log the field paths (never the values) as a warning.
 * - Anything else is a bug: log it and show a reference the user can quote.
 */
export const handleError: HandleServerError = ({ kind, error, issues, event }) => {
	if (kind === 'app' || kind === 'framework') return;

	if (kind === 'validation') {
		logger.warn('invalid remote function input', {
			route: event.route.id,
			fields: issues.map((issue) => issue.path?.map(String).join('.') ?? '')
		});
		return { message: 'Invalid request', code: 'INVALID_INPUT' };
	}

	if (error instanceof BusinessError) {
		return { status: error.status, message: error.message, code: error.code };
	}
	if (error instanceof ZodError) {
		return { status: 400, message: 'Check your input', code: 'INVALID_INPUT' };
	}

	const reference = event.locals.requestId ?? crypto.randomUUID();
	logger.error('unhandled server error', { route: event.route.id, ...describeError(error) });
	if (dev) console.error(error);
	return {
		status: 500,
		message: 'Something went wrong. Please try again.',
		code: 'UNEXPECTED',
		reference
	};
};

function setSecurityHeaders(headers: Headers, url: URL) {
	// Pages show private financial work: never let browsers or proxies cache them.
	headers.set('cache-control', 'private, no-store');
	headers.set('x-content-type-options', 'nosniff');
	headers.set('x-frame-options', 'DENY');
	headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
	// Same-origin referrers keep SvelteKit's CSRF check working for native form posts.
	// Email codes travel in the URL fragment, which browsers never send as a referrer.
	headers.set('referrer-policy', 'same-origin');
	if (url.protocol === 'https:') headers.set('strict-transport-security', 'max-age=31536000');
}
