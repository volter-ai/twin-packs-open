// Supabase Auth (GoTrue) as a lane of the supabase pack (docs/contributing/architecture.md, "Other wires: lanes"): a
// project's `https://<ref>.supabase.co/auth/v1`. The surface is generated (./generated/surface.gen.json, from ../spec by
// scripts/derive-pack.ts): GoTrue v2.197.0's own OpenAPI document with the two routes its router serves and the document
// omits (../spec/patches.json), 61 operations.
//
// WHAT IS MODELLED: nothing. No demanded application calls Auth (../../journeys/demand.json: RH2 speaks the Postgres wire
// to its Supabase database, with no anon session), so every operation answers the gap, GoTrue's 404, and the lane keeps
// no state (../../journeys/decisions.json).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'supabase',
  service: 'supabase',
  body: {},
  ids: { template: '{prefix}_{n}' },
  time: 'iso',
  // GoTrue's legacy error body (`{ code: <status>, error_code, msg }`)
  error: { code: '{status}', error_code: '{code}', msg: '{message}' },
  readOnly: { status: 405, code: 'read_only', message: 'This twin was started read-only; writes are refused.' },
  malformedBody: { status: 400, code: 'bad_json', message: 'Could not parse request body as JSON' },
  notFound: { status: 404, code: 'not_found', message: 'Not Found' },
  // a path GoTrue does not have, or an operation the lane does not model: GoTrue's 404
  gap: { status: 404, code: 'not_found', message: 'Not Found' },
  deleted: {},
  resources: {},
  ...states,
};
