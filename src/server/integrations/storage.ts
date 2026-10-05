import type { StorageConfig } from '../config';
import { BusinessError } from '../errors';
import { describeError, logger } from '../logger';

// S3-compatible file storage (MinIO locally, Cloudflare R2 in production), using Bun's
// built-in S3 client. Keys are always made by the app, never from user input.

export type FileStorage = {
	put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
	/** The stored file's contents as a stream, or null if there is no file at `key`. */
	open(key: string): Promise<ReadableStream<Uint8Array> | null>;
};

export function createFileStorage(config: StorageConfig): FileStorage {
	const client = new Bun.S3Client({
		endpoint: config.endpoint,
		bucket: config.bucket,
		region: config.region,
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey
	});

	/** Storage failures become STORAGE_UNAVAILABLE, logged without file contents. */
	async function attempt<T>(action: string, work: () => Promise<T>) {
		try {
			return await work();
		} catch (error) {
			logger.error(`file storage ${action} failed`, describeError(error));
			throw new BusinessError('STORAGE_UNAVAILABLE');
		}
	}

	return {
		put: (key, bytes, contentType) =>
			attempt('write', async () => {
				await client.write(key, bytes, { type: contentType });
			}),
		open: (key) =>
			attempt('read', async () => {
				const file = client.file(key);
				return (await file.exists()) ? file.stream() : null;
			})
	};
}
