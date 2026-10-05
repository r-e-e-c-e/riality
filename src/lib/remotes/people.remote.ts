import { query } from '$app/server';
import { people } from '#server/app.js';
import { requireUser } from '#server/request.js';
import { idSchema } from '#lib/schemas/tenancy.js';

// Used by the People page and entity pages.

/** All the firm's people with their roles (owners and admins). */
export const getPeople = query(idSchema, (firmId) => people.listPeople(requireUser(), firmId));
