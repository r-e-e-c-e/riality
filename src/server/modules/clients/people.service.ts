import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Config } from '../../config';
import type { Database, Transaction } from '../../db/connection';
import { inTransaction } from '../../db/transaction';
import { BusinessError, notFound, postgresErrorCode } from '../../errors';
import type { BirthMonth, CompaniesHouse } from '../../integrations/companies-house';
import type { ControlKind, EntityRoleKind, PersonKind } from '#lib/people.js';
import { entityScopeSchema } from '#lib/schemas/clients.js';
import {
	addRoleSchema,
	personScopeSchema,
	roleScopeSchema,
	updatePersonSchema,
	updateRoleSchema
} from '#lib/schemas/people.js';
import { idSchema } from '#lib/schemas/tenancy.js';
import { changedFields, recordEvent } from '../audit/audit-event.service';
import { RATE_LIMITS, createRateLimiter } from '../identity/rate-limit.service';
import { requireFirmAdmin, type Actor } from '../tenancy/tenancy-access';
import { entities } from './client.entity';
import { requireEntityViewer } from './entity-access';
import { entityRoles, people } from './person.entity';

type Person = typeof people.$inferSelect;
type EntityRole = typeof entityRoles.$inferSelect;

/** A person as Companies House lists them, before we know whether we already have them. */
type RegisterPerson = {
	name: string;
	kind: PersonKind;
	birth: BirthMonth | null;
	officerId: string | null;
};

/** A role as Companies House lists it. */
type RegisterRole = {
	person: RegisterPerson;
	role: EntityRoleKind;
	startedOn: string | null;
	endedOn: string | null;
	controls: ControlKind[];
};

/** The columns shown wherever a role is listed. */
const roleColumns = {
	id: entityRoles.id,
	role: entityRoles.role,
	startedOn: entityRoles.startedOn,
	endedOn: entityRoles.endedOn,
	shareholdingPercent: entityRoles.shareholdingPercent,
	controls: entityRoles.controls,
	source: entityRoles.source
};

/** Turns the unique-role violation (same person, role and start date) into ROLE_EXISTS. */
async function withRoleCheck<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (postgresErrorCode(error) === '23505') throw new BusinessError('ROLE_EXISTS');
		throw error;
	}
}

/**
 * Is `person` the one Companies House lists? The officer ID decides when both have one.
 * Otherwise the same kind and name, plus the same month and year of birth for
 * individuals (organisations have none). Two different people would need the same
 * name and birth month to be confused, which the firm can fix by hand.
 */
function isSamePerson(person: Person, listed: RegisterPerson) {
	if (listed.officerId && person.companiesHouseOfficerId)
		return listed.officerId === person.companiesHouseOfficerId;
	return (
		person.kind === listed.kind &&
		person.name.toLowerCase() === listed.name.toLowerCase() &&
		person.birthMonth === (listed.birth?.month ?? null) &&
		person.birthYear === (listed.birth?.year ?? null)
	);
}

/**
 * People (directors, shareholders, people with significant control, contacts) and
 * their roles at entities. Owners and admins manage them and see everyone; members
 * see the people of entities they have engagements for.
 */
export function createPeopleService(
	db: Database,
	config: Pick<Config, 'encryptionKey'>,
	companiesHouse: CompaniesHouse | null
) {
	const limiter = createRateLimiter(db, config.encryptionKey);

	async function findEntity(tx: Transaction, firmId: string, entityId: string) {
		const [entity] = await tx
			.select()
			.from(entities)
			.where(and(eq(entities.firmId, firmId), eq(entities.id, entityId)));
		if (!entity) throw notFound('Entity');
		return entity;
	}

	async function findPerson(tx: Transaction | Database, firmId: string, personId: string) {
		const [person] = await tx
			.select()
			.from(people)
			.where(and(eq(people.firmId, firmId), eq(people.id, personId)));
		if (!person) throw notFound('Person');
		return person;
	}

	async function findRole(tx: Transaction, firmId: string, roleId: string) {
		const [role] = await tx
			.select()
			.from(entityRoles)
			.where(and(eq(entityRoles.firmId, firmId), eq(entityRoles.id, roleId)));
		if (!role) throw notFound('Role');
		return role;
	}

	async function createPerson(
		tx: Transaction,
		actor: Actor,
		values: typeof people.$inferInsert,
		source: 'manual' | 'companies_house'
	) {
		const [person] = await tx.insert(people).values(values).returning();
		await recordEvent(tx, {
			action: 'person.created',
			actorId: actor.id,
			tenantId: values.firmId,
			target: { type: 'person', id: person.id },
			details: { source }
		});
		return person;
	}

	/**
	 * Saves the roles Companies House lists for an entity: matches each person to one
	 * the firm already has (or adds them), adds new roles and updates end dates and
	 * controls on roles imported before. Roles entered by hand are left alone.
	 */
	async function saveRegisterRoles(
		tx: Transaction,
		actor: Actor,
		entity: { firmId: string; id: string },
		listed: RegisterRole[]
	) {
		const { firmId } = entity;
		const officerIds = listed.flatMap((item) => item.person.officerId ?? []);
		const names = [...new Set(listed.map((item) => item.person.name.toLowerCase()))];
		const known =
			names.length === 0
				? []
				: await tx
						.select()
						.from(people)
						.where(
							and(
								eq(people.firmId, firmId),
								or(
									inArray(sql`lower(${people.name})`, names),
									officerIds.length > 0
										? inArray(people.companiesHouseOfficerId, officerIds)
										: undefined
								)
							)
						);
		const existingRoles = await tx
			.select()
			.from(entityRoles)
			.where(and(eq(entityRoles.firmId, firmId), eq(entityRoles.entityId, entity.id)));
		const counts = { peopleAdded: 0, rolesAdded: 0, rolesUpdated: 0 };

		for (const item of listed) {
			let person = known.find((candidate) => isSamePerson(candidate, item.person));
			if (!person) {
				person = await createPerson(
					tx,
					actor,
					{
						firmId,
						kind: item.person.kind,
						name: item.person.name,
						birthMonth: item.person.birth?.month ?? null,
						birthYear: item.person.birth?.year ?? null,
						companiesHouseOfficerId: item.person.officerId
					},
					'companies_house'
				);
				known.push(person);
				counts.peopleAdded++;
			} else if (item.person.officerId && !person.companiesHouseOfficerId) {
				// First seen as a PSC (no officer ID), now as an officer: remember the ID.
				await tx
					.update(people)
					.set({ companiesHouseOfficerId: item.person.officerId })
					.where(and(eq(people.firmId, firmId), eq(people.id, person.id)));
				person.companiesHouseOfficerId = item.person.officerId;
				await recordEvent(tx, {
					action: 'person.updated',
					actorId: actor.id,
					tenantId: firmId,
					target: { type: 'person', id: person.id },
					details: { changed: ['companiesHouseOfficerId'] }
				});
			}

			const sameRole = (role: EntityRole) =>
				role.personId === person.id && role.role === item.role && role.startedOn === item.startedOn;
			const existing = existingRoles.find(sameRole);
			if (!existing) {
				const [added] = await tx
					.insert(entityRoles)
					.values({
						firmId,
						entityId: entity.id,
						personId: person.id,
						role: item.role,
						startedOn: item.startedOn,
						endedOn: item.endedOn,
						controls: item.controls,
						source: 'companies_house'
					})
					.returning();
				existingRoles.push(added);
				await recordEvent(tx, {
					action: 'entity_role.added',
					actorId: actor.id,
					tenantId: firmId,
					target: { type: 'entity', id: entity.id },
					details: {
						roleId: added.id,
						personId: person.id,
						role: item.role,
						source: 'companies_house'
					}
				});
				counts.rolesAdded++;
				continue;
			}
			if (existing.source !== 'companies_house') continue;
			const changes = { endedOn: item.endedOn, controls: item.controls };
			const changed = changedFields(existing, changes);
			if (changed.length === 0) continue;
			await tx
				.update(entityRoles)
				.set(changes)
				.where(and(eq(entityRoles.firmId, firmId), eq(entityRoles.id, existing.id)));
			await recordEvent(tx, {
				action: 'entity_role.updated',
				actorId: actor.id,
				tenantId: firmId,
				target: { type: 'entity', id: entity.id },
				details: { roleId: existing.id, changed, source: 'companies_house' }
			});
			counts.rolesUpdated++;
		}
		return counts;
	}

	return {
		/** Everyone with a role at the entity, current and past. Same access as the entity. */
		async listEntityPeople(actor: Actor, input: z.infer<typeof entityScopeSchema>) {
			const scope = entityScopeSchema.parse(input);
			await requireEntityViewer(db, actor, scope);
			return db
				.select({
					...roleColumns,
					personId: people.id,
					personName: people.name,
					personKind: people.kind
				})
				.from(entityRoles)
				.innerJoin(
					people,
					and(eq(people.firmId, entityRoles.firmId), eq(people.id, entityRoles.personId))
				)
				.where(and(eq(entityRoles.firmId, scope.firmId), eq(entityRoles.entityId, scope.entityId)))
				.orderBy(asc(people.name), asc(entityRoles.role), asc(entityRoles.startedOn));
		},

		/** All the firm's people with their roles (owners and admins). */
		async listPeople(actor: Actor, firmId: string) {
			const id = idSchema.parse(firmId);
			await requireFirmAdmin(db, actor, id);
			const rows = await db
				.select({
					person: { id: people.id, name: people.name, kind: people.kind, email: people.email },
					role: {
						role: entityRoles.role,
						endedOn: entityRoles.endedOn,
						entityId: entities.id,
						entityName: entities.name
					}
				})
				.from(people)
				.leftJoin(
					entityRoles,
					and(eq(entityRoles.firmId, people.firmId), eq(entityRoles.personId, people.id))
				)
				.leftJoin(
					entities,
					and(eq(entities.firmId, entityRoles.firmId), eq(entities.id, entityRoles.entityId))
				)
				.where(eq(people.firmId, id))
				.orderBy(asc(people.name), asc(people.id), asc(entities.name));

			// Group the rows into people, each with their roles.
			type Role = {
				role: EntityRoleKind;
				endedOn: string | null;
				entityId: string;
				entityName: string;
			};
			const list: ((typeof rows)[number]['person'] & { roles: Role[] })[] = [];
			for (const row of rows) {
				let person = list.at(-1);
				if (person?.id !== row.person.id) {
					person = { ...row.person, roles: [] };
					list.push(person);
				}
				const { role } = row;
				if (role?.role && role.entityId && role.entityName) {
					person.roles.push({
						...role,
						role: role.role,
						entityId: role.entityId,
						entityName: role.entityName
					});
				}
			}
			return list;
		},

		/** One person with their contact details and roles (owners and admins). */
		async getPerson(actor: Actor, input: z.infer<typeof personScopeSchema>) {
			const { firmId, personId } = personScopeSchema.parse(input);
			await requireFirmAdmin(db, actor, firmId);
			const person = await findPerson(db, firmId, personId);
			const roles = await db
				.select({ ...roleColumns, entityId: entities.id, entityName: entities.name })
				.from(entityRoles)
				.innerJoin(
					entities,
					and(eq(entities.firmId, entityRoles.firmId), eq(entities.id, entityRoles.entityId))
				)
				.where(and(eq(entityRoles.firmId, firmId), eq(entityRoles.personId, personId)))
				.orderBy(asc(entities.name), asc(entityRoles.role), asc(entityRoles.startedOn));
			return { ...person, roles };
		},

		/** Adds a role at an entity, for an existing person or a new one. Owners and admins. */
		async addRole(actor: Actor, input: z.input<typeof addRoleSchema>) {
			const values = addRoleSchema.parse(input);
			const { firmId, entityId } = values;
			return withRoleCheck(() =>
				inTransaction(db, async (tx) => {
					await requireFirmAdmin(tx, actor, firmId);
					await findEntity(tx, firmId, entityId);
					const person = values.personId
						? await findPerson(tx, firmId, values.personId)
						: await createPerson(
								tx,
								actor,
								{ firmId, name: values.name!, kind: values.kind ?? 'individual' },
								'manual'
							);
					const [role] = await tx
						.insert(entityRoles)
						.values({
							firmId,
							entityId,
							personId: person.id,
							role: values.role,
							startedOn: values.startedOn ?? null,
							endedOn: values.endedOn ?? null,
							shareholdingPercent: values.shareholdingPercent ?? null,
							source: 'manual'
						})
						.returning();
					await recordEvent(tx, {
						action: 'entity_role.added',
						actorId: actor.id,
						tenantId: firmId,
						target: { type: 'entity', id: entityId },
						details: { roleId: role.id, personId: person.id, role: role.role, source: 'manual' }
					});
					return { role, person };
				})
			);
		},

		/** Edits a role's dates and shareholding. Owners and admins. */
		async updateRole(actor: Actor, input: z.input<typeof updateRoleSchema>) {
			const { firmId, roleId, ...form } = updateRoleSchema.parse(input);
			return withRoleCheck(() =>
				inTransaction(db, async (tx) => {
					await requireFirmAdmin(tx, actor, firmId);
					const before = await findRole(tx, firmId, roleId);
					// Fields left empty are cleared. Only shareholders have a shareholding.
					const changes = {
						startedOn: form.startedOn ?? null,
						endedOn: form.endedOn ?? null,
						shareholdingPercent:
							before.role === 'shareholder' ? (form.shareholdingPercent ?? null) : null
					};
					const changed = changedFields(before, changes);
					if (changed.length === 0) return before;
					const [role] = await tx
						.update(entityRoles)
						.set(changes)
						.where(and(eq(entityRoles.firmId, firmId), eq(entityRoles.id, roleId)))
						.returning();
					await recordEvent(tx, {
						action: 'entity_role.updated',
						actorId: actor.id,
						tenantId: firmId,
						target: { type: 'entity', id: before.entityId },
						details: { roleId, changed, source: 'manual' }
					});
					return role;
				})
			);
		},

		/** Removes a role entered by mistake. (To record that a role ended, set its end date.) */
		async removeRole(actor: Actor, input: z.infer<typeof roleScopeSchema>) {
			const { firmId, roleId } = roleScopeSchema.parse(input);
			return inTransaction(db, async (tx) => {
				await requireFirmAdmin(tx, actor, firmId);
				const role = await findRole(tx, firmId, roleId);
				await tx
					.delete(entityRoles)
					.where(and(eq(entityRoles.firmId, firmId), eq(entityRoles.id, roleId)));
				await recordEvent(tx, {
					action: 'entity_role.removed',
					actorId: actor.id,
					tenantId: firmId,
					target: { type: 'entity', id: role.entityId },
					details: { roleId, personId: role.personId, role: role.role }
				});
				return role;
			});
		},

		/** Edits a person's name and contact details. Owners and admins. */
		async updatePerson(actor: Actor, input: z.input<typeof updatePersonSchema>) {
			const { firmId, personId, ...form } = updatePersonSchema.parse(input);
			// Fields left empty are cleared.
			const changes = { name: form.name, email: form.email ?? null, phone: form.phone ?? null };
			return inTransaction(db, async (tx) => {
				await requireFirmAdmin(tx, actor, firmId);
				const before = await findPerson(tx, firmId, personId);
				const changed = changedFields(before, changes);
				if (changed.length === 0) return before;
				const [person] = await tx
					.update(people)
					.set(changes)
					.where(and(eq(people.firmId, firmId), eq(people.id, personId)))
					.returning();
				await recordEvent(tx, {
					action: 'person.updated',
					actorId: actor.id,
					tenantId: firmId,
					target: { type: 'person', id: personId },
					details: { changed }
				});
				return person;
			});
		},

		/**
		 * Imports the entity's officers and people with significant control from
		 * Companies House. Safe to run again: it adds what is new and updates end dates.
		 * Owners and admins.
		 */
		async importFromCompaniesHouse(actor: Actor, input: z.infer<typeof entityScopeSchema>) {
			const { firmId, entityId } = entityScopeSchema.parse(input);
			await requireFirmAdmin(db, actor, firmId);
			if (!companiesHouse) throw new BusinessError('COMPANIES_HOUSE_NOT_CONFIGURED');
			const [entity] = await db
				.select({ companyNumber: entities.companyNumber })
				.from(entities)
				.where(and(eq(entities.firmId, firmId), eq(entities.id, entityId)));
			if (!entity) throw notFound('Entity');
			if (!entity.companyNumber) throw new BusinessError('COMPANY_NOT_FOUND');

			// Two lookups: officers and people with significant control.
			await limiter.consume(RATE_LIMITS.companiesHouseLookupsPerUser, actor.id);
			await limiter.consume(RATE_LIMITS.companiesHouseLookupsPerUser, actor.id);
			const [officers, controllers] = await Promise.all([
				companiesHouse.getOfficers(entity.companyNumber),
				companiesHouse.getSignificantControl(entity.companyNumber)
			]);
			const listed: RegisterRole[] = [
				...officers.map((officer) => ({
					person: officer,
					role: officer.role,
					startedOn: officer.appointedOn,
					endedOn: officer.resignedOn,
					controls: []
				})),
				...controllers.map((controller) => ({
					person: { ...controller, officerId: null },
					role: 'psc' as const,
					startedOn: controller.notifiedOn,
					endedOn: controller.ceasedOn,
					controls: controller.controls
				}))
			];

			return inTransaction(db, async (tx) => {
				await requireFirmAdmin(tx, actor, firmId);
				const current = await findEntity(tx, firmId, entityId);
				return saveRegisterRoles(tx, actor, current, listed);
			});
		}
	};
}
