import { building, dev } from '$app/env';
import * as env from '$app/env/private';
import { createConfig } from './config';
import { openDatabase } from './db/connection';
import { createServices } from './services';

// The running web app's config, database and services. Only SvelteKit code (hooks
// and remote functions) imports this file; scripts and tests build their own.

export const config = createConfig(env, { building, dev });
export const { db } = openDatabase(config.databaseUrl);
export const services = createServices(db, config);
export const { identity, mfa, tenancy, invitations, engagements } = services;
