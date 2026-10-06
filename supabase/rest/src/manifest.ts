// PostgREST (a project's `https://<ref>.supabase.co/rest/v1`) as a lane of the supabase pack (docs/contributing/
// architecture.md, "Other wires: lanes"). PostgREST publishes no fixed spec (its OpenAPI is generated from each project's
// schema), so the surface is the calls its own client makes (../spec/client-ops.json: @supabase/postgrest-js 2.117.2),
// generated to ./generated/surface.gen.json by scripts/derive-pack.ts: 9 operations.
//
// WHAT IS MODELLED: nothing. No demanded application calls PostgREST (../../journeys/demand.json: RH2 speaks the Postgres
// wire to its Supabase database, "no PostgREST"), so every operation answers the gap, PostgREST's invalid path, and the
// lane keeps no state (../../journeys/decisions.json).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'supabase',
  service: 'supabase',
  body: {},
  ids: { template: '{prefix}_{n}' },
  time: 'iso',
  // PostgREST's error body: `{ code, details, hint, message }` (https://docs.postgrest.org/en/stable/references/errors.html)
  error: { code: '{code}', details: null, hint: null, message: '{message}' },
  // a read-only twin: Postgres refuses the write in a READ ONLY transaction, SQLSTATE 25006, which PostgREST answers 405
  readOnly: { status: 405, code: '25006', message: 'cannot execute INSERT in a read-only transaction' },
  // PGRST102: "An invalid request body was sent (e.g. an empty body or malformed JSON)." (the errors page)
  malformedBody: { status: 400, code: 'PGRST102', message: 'Empty or invalid json' },
  notFound: { status: 404, code: 'PGRST205', message: 'Could not find the table in the schema cache' },
  // a path PostgREST does not have, or an operation the lane does not model (the OpenAPI root): PostgREST's refusal of an
  // invalid path (PGRST125, "Invalid path specified in request URL", the errors page)
  gap: { status: 404, code: 'PGRST125', message: 'Invalid path specified in request URL' },
  // the gateway forwards a project's `/rest/v1` to PostgREST at its root, as Supabase's gateway does
  pathPrefix: '/rest/v1',
  deleted: null,
  resources: {},
};
