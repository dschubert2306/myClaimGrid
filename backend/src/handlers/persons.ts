import { personsResponseSchema, renamePersonRequestSchema } from '@myclaimgrid/shared';
import { createHandler, HttpError, idParam, ok, parseBody } from '../lib/http';
import { toPerson } from '../lib/items';
import { ensurePersons, getPerson, savePerson } from '../lib/repo';

export const handler = createHandler({
  // Seeds the three persons on first use.
  'GET /persons': async ({ sub }) => {
    const persons = await ensurePersons(sub);
    return ok(personsResponseSchema.parse({ persons: persons.map(toPerson) }));
  },

  'PUT /persons/{id}': async (req) => {
    const personId = idParam(req, 'id');
    const body = parseBody(req, renamePersonRequestSchema);
    const person = await getPerson(req.sub, personId);
    if (!person) throw new HttpError(404, 'not_found');
    const next = {
      ...person,
      name: body.name,
      color: body.color ?? person.color,
      deductible: body.deductible ?? person.deductible ?? 0,
    };
    await savePerson(next);
    return ok(toPerson(next));
  },
});
