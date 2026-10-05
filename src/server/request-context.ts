import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Facts about the HTTP request being handled right now. hooks.server.ts sets it once
 * per request. The logger and the audit log read it, so services never need to pass
 * request IDs around. Scripts and background jobs run without one.
 */
export type RequestContext = {
	requestId: string;
	userId?: string;
	sessionId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, run: () => T): T {
	return storage.run(context, run);
}

export function getRequestContext(): RequestContext | undefined {
	return storage.getStore();
}
