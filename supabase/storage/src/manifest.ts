// Supabase Storage as a lane of the supabase pack (docs/contributing/architecture.md, "Other wires: lanes"): a project's
// `https://<ref>.supabase.co/storage/v1`. The surface is generated (./generated/surface.gen.json, from ../spec by
// scripts/derive-pack.ts): storage-api's OpenAPI document as Supabase's documentation publishes it, 108 operations.
//
// WHAT IS MODELLED: nothing. No demanded application calls Storage (../../journeys/demand.json: RH2 speaks the Postgres
// wire to its Supabase database and nothing else), so every operation answers the gap, storage-api's unknown route, and
// the lane keeps no state (../../journeys/decisions.json).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'supabase',
  service: 'supabase',
  body: {},
  ids: { template: '{prefix}_{n}' },
  time: 'iso',
  // storage-api's error body (https://raw.githubusercontent.com/supabase/storage/v1.79.22/src/http/error-handler.ts): the
  // error's own status as text, its code, its `error` and its message; every error but a 500 is answered with HTTP 400
  // while its body names the error's status (source: https://raw.githubusercontent.com/supabase/storage/v1.79.22/src/http/error-handler.ts "renderableError.statusCode === '500'")
  error: { statusCode: '{statusText}', code: '{code}', error: '{kind}', message: '{message}' },
  errorsAnsweredAs: { status: 400, below: 500 },
  defaultKind: 'Bad Request',
  readOnly: { status: 403, code: 'AccessDenied', kind: 'Unauthorized', message: 'This twin was started read-only; writes are refused.' },
  // storage-api's request validation: InvalidRequest, "The request is not properly formed."
  // (https://supabase.com/docs/guides/storage/debugging/error-codes)
  malformedBody: { status: 400, code: 'InvalidRequest', kind: 'Bad Request', message: 'Body is not valid JSON' },
  notFound: { status: 404, code: 'NoSuchKey', kind: 'not_found', message: 'Object not found' },
  // a path storage-api does not have, or an operation the lane does not model: storage-api's (Fastify's) unknown route
  gap: { status: 404, code: 'NotFound', kind: 'Not Found', message: 'Route {method}:{path} not found' },
  // the gateway forwards a project's `/storage/v1` to storage-api at its root
  pathPrefix: '/storage/v1',
  // an object's key holds slashes: the spec's `{*}` takes the rest of the path, as storage-api's `/*` route does
  spanning: ['*'],
  deleted: { message: 'Successfully deleted' },
  resources: {},
};
