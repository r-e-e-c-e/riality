import { userInfo } from 'node:os';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { variables } from '../../src/env';
import { createConfig, type Config, type Environment } from '../../src/server/config';
import { openDatabase, type Database } from '../../src/server/db/connection';
import { BusinessError } from '../../src/server/errors';
import { createServices, type Services } from '../../src/server/services';

// Shared setup for scripts. Bun loads .env automatically.

type Definition = { schema?: StandardSchemaV1<string | undefined, unknown> };

/** Reads process.env and validates it with the same schemas SvelteKit uses (src/env.ts). */
export function readEnvironment(): Environment {
	const environment: Record<string, string | undefined> = {};
	const problems: string[] = [];

	for (const [name, definition] of Object.entries(variables as Record<string, Definition>)) {
		const value = process.env[name];
		if (!definition.schema) {
			// No schema means "required" in SvelteKit.
			if (value === undefined) problems.push(`${name} is required`);
			environment[name] = value;
			continue;
		}
		const result = definition.schema['~standard'].validate(value);
		if (result instanceof Promise) throw new Error(`${name} uses an async schema`);
		if (result.issues) {
			problems.push(`${name}: ${result.issues.map((issue) => issue.message).join(', ')}`);
		} else {
			environment[name] = result.value as string | undefined;
		}
	}

	if (problems.length > 0) throw new Error(`Invalid environment:\n${problems.join('\n')}`);
	return environment as Environment;
}

export function readConfig(): Config {
	return createConfig(readEnvironment());
}

/** The database and the settings the dev reset/seed guards check before touching it. */
export function readDevelopmentTarget() {
	const config = readConfig();
	const environment = {
		nodeEnv: process.env.NODE_ENV,
		origin: config.origin,
		mailMode: config.mail.mode
	};
	return { databaseUrl: config.databaseUrl, environment };
}

/** Opens the database, builds the services, runs `task` and always closes the connection. */
export async function withServices<T>(
	task: (context: { config: Config; db: Database; services: Services }) => Promise<T>
): Promise<T> {
	const config = readConfig();
	const { db, close } = openDatabase(config.databaseUrl);
	try {
		return await task({ config, db, services: createServices(db, config) });
	} finally {
		await close();
	}
}

/** The person running an operator script, recorded in the audit history. */
export function operator() {
	return { name: userInfo().username };
}

/** Operator scripts must be run by a person at a terminal, never by automation. */
export function requireInteractiveTerminal() {
	if (!process.stdin.isTTY) throw new Error('Run this command interactively in a terminal');
}

/** Asks a question and returns the trimmed answer ('' if none). */
export function ask(question: string) {
	return (prompt(question) ?? '').trim();
}

/** Stops unless the operator types `expected` exactly. */
export function confirm(question: string, expected: string) {
	if (ask(`${question} Type ${expected} to continue:`) !== expected) throw new Error('Cancelled');
}

/** Reads a password without showing it on screen. */
export async function askHidden(question: string): Promise<string> {
	process.stdout.write(question);
	process.stdin.setRawMode(true);
	process.stdin.resume();
	try {
		return await new Promise<string>((resolve, reject) => {
			let value = '';
			const onData = (chunk: Buffer) => {
				for (const character of chunk.toString('utf8')) {
					if (character === '\u0003') {
						process.stdin.off('data', onData);
						reject(new Error('Cancelled'));
						return;
					}
					if (character === '\r' || character === '\n') {
						process.stdin.off('data', onData);
						resolve(value);
						return;
					}
					if (character === '\u007f' || character === '\b')
						value = Array.from(value).slice(0, -1).join('');
					else if (character >= ' ' && value.length < 129) value += character;
				}
			};
			process.stdin.on('data', onData);
		});
	} finally {
		process.stdin.setRawMode(false);
		process.stdin.pause();
		process.stdout.write('\n');
	}
}

/**
 * Runs a script's main function. Our own errors (plain Error and BusinessError) print
 * their message. Other errors, such as database errors, print only their type,
 * because their messages can contain personal data.
 */
export async function runScript(main: () => Promise<void>) {
	try {
		await main();
	} catch (error) {
		const isOurs =
			error instanceof BusinessError || (error instanceof Error && error.constructor === Error);
		console.error(
			isOurs ? (error as Error).message : `Failed: ${(error as Error)?.name ?? 'Unknown error'}`
		);
		process.exitCode = 1;
	}
}
