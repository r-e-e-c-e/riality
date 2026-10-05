// Small cryptography helpers built on Web Crypto. Keep cryptography in this file
// (and in totp.ts and passwords.ts) so it is easy to review in one place.

const encoder = new TextEncoder();

/** A random 32-byte token, base64url encoded (43 characters). Used for sessions and email codes. */
export function createRandomToken(): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

/**
 * SHA-256 of a random token, as hex. We store this instead of the token itself.
 * A plain hash is safe here because the tokens are long and random; passwords use Argon2.
 */
export async function hashToken(token: string): Promise<string> {
	const hash = await crypto.subtle.digest('SHA-256', encoder.encode(token));
	return Buffer.from(hash).toString('hex');
}

export type SecretBox = ReturnType<typeof createSecretBox>;

/**
 * Encryption and keyed hashing with AUTH_ENCRYPTION_KEY. Two separate keys are
 * derived from it (HKDF): one for AES-GCM encryption, one for HMAC fingerprints.
 *
 * `context` names what is being encrypted (for example `mfa:<userId>`). Decryption
 * fails if the context differs, so a secret cannot be copied onto another record.
 */
export function createSecretBox(encodedKey: string) {
	const keyBytes = Buffer.from(encodedKey, 'base64');
	if (keyBytes.length !== 32 || keyBytes.toString('base64') !== encodedKey)
		throw new Error('AUTH_ENCRYPTION_KEY must be a base64-encoded 32-byte key');

	const rootKey = crypto.subtle.importKey('raw', keyBytes, 'HKDF', false, ['deriveKey']);
	const deriveKey = async (purpose: string, algorithm: AesKeyGenParams | HmacKeyGenParams) =>
		crypto.subtle.deriveKey(
			{
				name: 'HKDF',
				hash: 'SHA-256',
				salt: encoder.encode('Lines v1'),
				info: encoder.encode(purpose)
			},
			await rootKey,
			algorithm,
			false,
			algorithm.name === 'AES-GCM' ? ['encrypt', 'decrypt'] : ['sign']
		);
	const encryptionKey = deriveKey('credential encryption', { name: 'AES-GCM', length: 256 });
	const fingerprintKey = deriveKey('fingerprints', {
		name: 'HMAC',
		hash: 'SHA-256',
		length: 256
	});

	return {
		/** Returns `v1.<iv>.<ciphertext>`. */
		async encrypt(plaintext: string, context: string): Promise<string> {
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const ciphertext = await crypto.subtle.encrypt(
				{ name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
				await encryptionKey,
				encoder.encode(plaintext)
			);
			const iv64 = Buffer.from(iv).toString('base64url');
			return `v1.${iv64}.${Buffer.from(ciphertext).toString('base64url')}`;
		},

		async decrypt(encrypted: string, context: string): Promise<string> {
			const [version, iv, ciphertext] = encrypted.split('.');
			if (version !== 'v1' || !iv || !ciphertext) throw new Error('Invalid encrypted value');
			const plaintext = await crypto.subtle.decrypt(
				{
					name: 'AES-GCM',
					iv: Buffer.from(iv, 'base64url'),
					additionalData: encoder.encode(context)
				},
				await encryptionKey,
				Buffer.from(ciphertext, 'base64url')
			);
			return new TextDecoder().decode(plaintext);
		},

		/**
		 * A keyed hash (HMAC) of a value such as an email or IP address. Lets us count or
		 * match values without storing them. Fingerprints are still personal data.
		 */
		async fingerprint(value: string): Promise<string> {
			const signature = await crypto.subtle.sign(
				'HMAC',
				await fingerprintKey,
				encoder.encode(value)
			);
			return Buffer.from(signature).toString('hex');
		}
	};
}
