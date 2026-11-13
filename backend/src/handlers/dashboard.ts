import { dashboardQuerySchema, dashboardResponseSchema } from '@myclaimgrid/shared';
import { createHandler, ok, parseQuery } from '../lib/http';
import { listClaimYears, listClaims, listPersons } from '../lib/repo';

export const handler = createHandler({
  'GET /dashboard': async (req) => {
    const { year = new Date().getUTCFullYear() } = parseQuery(req, dashboardQuerySchema);
    // Read only: the persons are seeded by GET /persons, which the app calls first.
    const persons = await listPersons(req.sub);

    const perPerson = await Promise.all(
      persons.map(async (person) => {
        const [claims, years] = await Promise.all([
          listClaims(person.personId, year),
          listClaimYears(person.personId),
        ]);
        return { person, claims, years };
      }),
    );

    const years = [...new Set(perPerson.flatMap((p) => p.years))].sort((a, b) => b - a);
    return ok(
      dashboardResponseSchema.parse({
        year,
        years,
        persons: perPerson.map(({ person, claims }) => ({
          personId: person.personId,
          name: person.name,
          color: person.color,
          count: claims.length,
          totalAmount: claims.reduce((sum, c) => sum + (c.amount ?? 0), 0),
        })),
      }),
    );
  },
});
