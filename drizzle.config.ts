import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

export default defineConfig({
	schema: './src/server/modules/**/*.entity.ts',
	dialect: 'postgresql',
	schemaFilter: ['public'],
	dbCredentials: { url: process.env.DATABASE_URL },
	verbose: true
});
