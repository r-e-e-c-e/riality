import { BusinessError } from '../../errors';
import { logger } from '../../logger';

// Argon2id settings: 64 MiB of memory and two passes per hash.
const ARGON2_OPTIONS = { algorithm: 'argon2id', memoryCost: 65536, timeCost: 2 } as const;

// Each hash uses 64 MiB, so only a few run at once. Extra requests wait in a queue
// (a burst of staff signing in at 9am just waits a moment). Only a queue this long
// is refused, which means the server is under attack or badly overloaded.
const MAX_RUNNING_HASHES = 4;
const MAX_WAITING_HASHES = 200;
let runningHashes = 0;
const waitingHashes: (() => void)[] = [];

async function withHashingSlot<T>(work: () => Promise<T>): Promise<T> {
	if (runningHashes < MAX_RUNNING_HASHES) {
		runningHashes++;
	} else {
		if (waitingHashes.length >= MAX_WAITING_HASHES) throw new BusinessError('SIGN_IN_BUSY');
		// Wait until a running hash finishes and hands over its slot.
		await new Promise<void>((resolve) => waitingHashes.push(resolve));
	}
	try {
		return await work();
	} finally {
		const next = waitingHashes.shift();
		if (next) next();
		else runningHashes--;
	}
}

export function hashPassword(password: string): Promise<string> {
	return withHashingSlot(() => Bun.password.hash(password, ARGON2_OPTIONS));
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
	return withHashingSlot(() => Bun.password.verify(password, hash));
}

// A small offline list for development. Public deployments also check the
// Have I Been Pwned breach list (see createPasswordPolicy).
const COMMON_PASSWORDS = new Set([
	'passwordpassword',
	'password12345678',
	'123456789012345',
	'12345678901234567890',
	'qwertyuiopasdfgh',
	'letmeinletmeinletmein'
]);

export type PasswordCheck = (password: string) => Promise<void>;

/**
 * Rejects common and breached passwords. Length rules live in passwordSchema.
 *
 * The breach check (k-anonymity): only the first five characters of the password's
 * SHA-1 hash are sent to Have I Been Pwned, and we look for the rest of the hash in
 * the reply. If the service is down we refuse the new password (503) rather than
 * accept one we could not check; existing passwords and sign-in are unaffected.
 *
 * `request` is replaceable so tests never send real lookups.
 */
export function createPasswordPolicy(
	checkBreaches: boolean,
	request: (url: string, options: RequestInit) => Promise<Response> = fetch
): PasswordCheck {
	return async (password) => {
		if (COMMON_PASSWORDS.has(password.toLowerCase()) || /^(.)\1+$/su.test(password))
			throw new BusinessError('PASSWORD_TOO_COMMON');
		if (!checkBreaches) return;

		const sha1 = Buffer.from(
			await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password))
		)
			.toString('hex')
			.toUpperCase();
		const prefix = sha1.slice(0, 5);
		const suffix = sha1.slice(5);

		let lines: string[];
		try {
			const response = await request(`https://api.pwnedpasswords.com/range/${prefix}`, {
				headers: { 'Add-Padding': 'true', 'User-Agent': 'Lines-password-screening' },
				redirect: 'error',
				signal: AbortSignal.timeout(5000)
			});
			if (!response.ok) throw new Error('Password screening unavailable');
			const body = await response.text();
			lines = body.trim().split(/\r?\n/);
			const looksValid =
				body.length <= 262144 &&
				body.trim() !== '' &&
				lines.every((line) => /^[A-F0-9]{35}:\d+$/.test(line));
			if (!looksValid) throw new Error('Invalid screening response');
		} catch {
			// Never log the password, its hash, or the provider's response.
			logger.warn('security event', { event: 'password.check_unavailable' });
			throw new BusinessError('PASSWORD_CHECK_UNAVAILABLE');
		}

		const breached = lines.some((line) => {
			const [lineSuffix, count] = line.split(':');
			return lineSuffix === suffix && Number(count) > 0;
		});
		if (breached) throw new BusinessError('PASSWORD_BREACHED');
	};
}
