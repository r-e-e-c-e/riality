import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, eq, gt, lt, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { MailConfig } from '../../config';
import type { Database, Transaction } from '../../db/connection';
import { logger } from '../../logger';
import { createSecretBox } from '../identity/identity.crypto';
import { mailOutbox } from './mail.entity';

const mailSchema = z.object({
	to: z.email(),
	subject: z.string().max(200),
	text: z.string().max(10000)
});
export type Mail = z.infer<typeof mailSchema>;

/** Sends one email. `id` is stable across retries, so providers can ignore duplicates. */
export type MailSender = (mail: Mail, id: string) => Promise<void>;

const MAX_RETRY_DELAY_SECONDS = 60 * 60;

/** Waits 30s, 1m, 2m, 4m... between attempts, up to an hour. */
function retryDelaySeconds(attempts: number) {
	return Math.min(MAX_RETRY_DELAY_SECONDS, 30 * 2 ** Math.min(attempts, 7));
}

/** The encrypted email outbox. See mail.entity.ts. */
export function createMailService(db: Database, encryptionKey: string) {
	const box = createSecretBox(encryptionKey);

	return {
		/** Queues an email in the caller's transaction, so it is only sent if the transaction commits. */
		async enqueue(tx: Transaction, mail: Mail, expiresAt: Date) {
			const id = Bun.randomUUIDv7();
			const message = JSON.stringify(mailSchema.parse(mail));
			await tx.insert(mailOutbox).values({
				id,
				encryptedMessage: await box.encrypt(message, `mail:${id}`),
				expiresAt
			});
		},

		/**
		 * Sends the oldest due email. Returns false when there is nothing to send.
		 *
		 * The row stays locked while sending; SKIP LOCKED lets several servers deliver
		 * at once without sending the same email twice. If sending fails, the email is
		 * retried later. Delivery is "at least once": a crash after sending but before
		 * the delete could send it again, which the provider's idempotency key prevents.
		 */
		async deliverNext(send: MailSender): Promise<boolean> {
			return db.transaction(async (tx) => {
				const now = new Date();
				const [queued] = await tx
					.select()
					.from(mailOutbox)
					.where(and(lte(mailOutbox.availableAt, now), gt(mailOutbox.expiresAt, now)))
					.orderBy(mailOutbox.createdAt)
					.for('update', { skipLocked: true })
					.limit(1);
				if (!queued) return false;

				try {
					const decrypted = await box.decrypt(queued.encryptedMessage, `mail:${queued.id}`);
					await send(mailSchema.parse(JSON.parse(decrypted)), queued.id);
					await tx.delete(mailOutbox).where(eq(mailOutbox.id, queued.id));
				} catch {
					const delay = retryDelaySeconds(queued.attempts);
					await tx
						.update(mailOutbox)
						.set({
							attempts: queued.attempts + 1,
							availableAt: new Date(Date.now() + delay * 1000)
						})
						.where(eq(mailOutbox.id, queued.id));
					// Never log the recipient, message or provider response.
					logger.error('mail delivery failed', { mailId: queued.id, attempt: queued.attempts + 1 });
				}
				return true;
			});
		},

		/** Deletes emails that expired before they could be sent. Run by the cleanup job. */
		async removeExpired() {
			await db.delete(mailOutbox).where(lt(mailOutbox.expiresAt, new Date()));
		}
	};
}

/** The sender for the configured MAIL_MODE. */
export function createMailSender(mail: MailConfig): MailSender {
	if (mail.mode === 'resend') return createResendSender(mail.apiKey, mail.from);
	return createPreviewSender();
}

/**
 * Local development only: writes each email to .local/mail/<id>.txt instead of
 * sending it. The files contain working sign-in links, so never share them.
 * config.ts refuses preview mode on public deployments.
 */
function createPreviewSender(directory = resolve('.local/mail')): MailSender {
	return async (mail, id) => {
		await mkdir(directory, { recursive: true, mode: 0o700 });
		await writeFile(resolve(directory, `${id}.txt`), JSON.stringify(mail, null, 2), {
			mode: 0o600
		});
	};
}

/** Sends through the Resend HTTP API. `request` is replaceable for tests. */
export function createResendSender(
	apiKey: string,
	from: string,
	request: (input: string, init: RequestInit) => Promise<Response> = fetch
): MailSender {
	if (!apiKey || !from || /[\r\n]/.test(from))
		throw new Error('Email delivery configuration is incomplete');
	return async (mail, id) => {
		const response = await request('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${apiKey}`,
				'content-type': 'application/json',
				'idempotency-key': id
			},
			body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
			signal: AbortSignal.timeout(10_000)
		});
		if (!response.ok) throw new Error('Email delivery failed');
	};
}
