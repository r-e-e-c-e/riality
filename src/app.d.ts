// See https://svelte.dev/docs/kit/types#app.d.ts
import type { ErrorCode } from './server/errors';
import type { AuthSession, AuthUser } from './server/modules/identity/identity.service';

declare global {
	namespace App {
		/** What the browser receives about an error (see handleError in hooks.server.ts). */
		interface Error {
			status: number;
			message: string;
			/** Lets pages react to specific errors, for example showing a sign-in link. */
			code?: ErrorCode;
			/** The request ID, shown for unexpected errors so users can quote it to support. */
			reference?: string;
		}
		interface Locals {
			/** Matches the x-request-id header, log lines and audit events for this request. */
			requestId: string;
			user: AuthUser | null;
			session: AuthSession | null;
		}
	}
}

export {};
