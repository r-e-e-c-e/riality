import type { MailConfig } from './config';
import { describeError, logger } from './logger';
import { createMailSender } from './modules/notifications/mail.service';
import type { Services } from './services';

const MAIL_INTERVAL_MS = 5_000;
const CLEANUP_INTERVAL_MS = 60 * 60_000;
const MAX_EMAILS_PER_RUN = 100;

// Remember running timers across dev-server reloads, so jobs never run twice.
const running = globalThis as { linesJobTimers?: ReturnType<typeof setInterval>[] };

/**
 * Background work that runs inside the web app process, started from the `init`
 * hook in hooks.server.ts. Safe with several app servers: mail delivery uses row
 * locks (SKIP LOCKED) and cleanup only deletes expired rows.
 *
 * - every 5 seconds: send queued emails
 * - every hour: delete expired sessions, codes, invitations, emails and rate-limit counters
 */
export function startBackgroundJobs(services: Services, mail: MailConfig) {
	stopBackgroundJobs();
	const send = createMailSender(mail);

	running.linesJobTimers = [
		repeat('deliver queued email', MAIL_INTERVAL_MS, async () => {
			for (let sent = 0; sent < MAX_EMAILS_PER_RUN; sent++) {
				if (!(await services.mail.deliverNext(send))) break;
			}
		}),
		repeat('remove expired records', CLEANUP_INTERVAL_MS, async () => {
			await services.identity.removeExpiredRecords();
			await services.invitations.removeExpired();
			await services.mail.removeExpired();
		})
	];
}

export function stopBackgroundJobs() {
	for (const timer of running.linesJobTimers ?? []) clearInterval(timer);
	running.linesJobTimers = [];
}

/** Runs `job` now and then every `intervalMs`, skipping a run if the previous one has not finished. */
function repeat(name: string, intervalMs: number, job: () => Promise<void>) {
	let busy = false;
	const run = async () => {
		if (busy) return;
		busy = true;
		try {
			await job();
		} catch (error) {
			logger.error(`background job failed: ${name}`, describeError(error));
		} finally {
			busy = false;
		}
	};
	void run();
	const timer = setInterval(run, intervalMs);
	timer.unref?.();
	return timer;
}
