// Authenticator app codes (TOTP, RFC 6238): HMAC-SHA1, six digits, 30-second steps.

const STEP_MILLISECONDS = 30_000;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 is the format authenticator apps expect for the shared secret. */
export function encodeBase32(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let output = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
	return output;
}

/** The code for one time step. */
export async function totp(secret: Uint8Array, step: number, digits = 6): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new Uint8Array(secret),
		{ name: 'HMAC', hash: 'SHA-1' },
		false,
		['sign']
	);
	const counter = new Uint8Array(8);
	new DataView(counter.buffer).setBigUint64(0, BigInt(step));
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));

	// "Dynamic truncation" from RFC 4226: read 4 bytes at an offset chosen by the last byte.
	const offset = mac[mac.length - 1] & 15;
	const number =
		((mac[offset] & 127) << 24) |
		(mac[offset + 1] << 16) |
		(mac[offset + 2] << 8) |
		mac[offset + 3];
	return String(number % 10 ** digits).padStart(digits, '0');
}

/**
 * Checks a code against the current step and one step either side (for clock drift).
 * Returns the matching step, or null. Steps at or before `lastUsedStep` are refused,
 * so each code works only once.
 */
export async function verifyTotp(
	secret: Uint8Array,
	code: string,
	lastUsedStep: number,
	now = Date.now()
): Promise<number | null> {
	if (!/^\d{6}$/.test(code)) return null;
	const currentStep = Math.floor(now / STEP_MILLISECONDS);
	for (const step of [currentStep, currentStep - 1, currentStep + 1]) {
		if (step > lastUsedStep && (await totp(secret, step)) === code) return step;
	}
	return null;
}
