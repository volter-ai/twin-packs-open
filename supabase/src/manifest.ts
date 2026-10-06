// Supabase's manifest: the vendor facts its published spec does not carry (docs/contributing/architecture.md, "What an
// author writes, and how"). The surface is generated (./generated/surface.gen.json, from ../spec by
// scripts/derive-pack.ts): the Management API's OpenAPI document as api.supabase.com publishes it, 170 operations. A
// project's data plane (`<ref>.supabase.co`) is the lanes': ../rest (PostgREST), ../storage (Storage) and ../auth (Auth).
//
// WHAT IS MODELLED is what the demanded applications use (../journeys/demand.json): a project's Postgres database, which
// RH2 reaches over the Postgres wire and nothing else (its migrations and its queries; "no PostgREST, no Supabase client
// library, no anon session"). The World's managed Postgres is that database (architecture.md, managed infrastructure):
// the credential door (./semantics/doors.ts) makes the World's project as the dashboard's sign-up makes one and answers
// the database's URL, and what the application sends the database is Postgres's own answer. No demanded application calls
// the Management API, PostgREST, Storage or Auth, so every operation of the four answers the gap
// (../journeys/decisions.json); the manifest declares no resource, so no derived core serves one.
//
// THE STATE is the World's project, the door's own bookkeeping (`_project`); the database's rows are the World's
// Postgres, never the tree.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'supabase',
  service: 'supabase',
  body: {},
  ids: { template: '{prefix}_{n}' },
  // `created_at`, `inserted_at`: ISO 8601 (../spec/recordings: "2000-01-01T00:00:00Z")
  time: 'iso',
  // the Management API's error body: `{ "message": … }`, as the live API answered every request without a token it holds
  // (../spec/recordings/2026-09-28-unauthenticated.json)
  error: { message: '{message}' },
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  // the documentation gives no answer for a body that is not JSON; the API's error body with a message stating the rule
  malformedBody: { status: 400, message: 'The request body is not valid JSON.' },
  notFound: { status: 404, message: 'Project not found' },
  deleted: { id: '{id}' },
  // An operation the twin does not model, or a path the spec does not have. The documentation gives no answer for an
  // unknown path; the API's error body with 404.
  gap: { status: 404, message: 'Not Found' },
  // a SQL wire: what the application sends the database is answered by Postgres, never stored as the vendor's resource
  vendorBacked: { none: "the demanded use is the project's Postgres database over its own wire; a statement is one turn of the application's session, so the World's SQL is never replayed against Supabase, and the twin stores no resource of the vendor's" },
  discovery: {
    twinOf: "a Supabase project's Postgres database, the World's managed Postgres",
    stores: "the World's project; the database's rows are the World's Postgres",
    identity: "POST /_twin/app-credentials answers the project's database URL (SUPABASE_DB_URL), which the application connects to with any Postgres client.",
  },
  // the World's door (./semantics/doors.ts): the account's sign-up, which makes its project
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the World's project and its database URL, as the runtime issues them at every boot" },
  ],
  resources: {},
  ...states,
  // Supabase's gateway in front of a project's data plane: `/rest/v1` to PostgREST (../rest), `/storage/v1` to Storage
  // (../storage) and `/auth/v1` to Auth (../auth), each at a project's host or the twin's own address, each answering its
  // own gap; the Management API's host keeps those paths (it has none of them, so they answer its gap).
  lanes: {
    routes: [
      { lane: 'rest', path: '/rest/v1', exceptHosts: ['api.supabase.com'] },
      { lane: 'storage', path: '/storage/v1', exceptHosts: ['api.supabase.com'] },
      { lane: 'auth', path: '/auth/v1', exceptHosts: ['api.supabase.com'] },
    ],
  },
  // the descriptor, as data (twin-world's architecture, "The descriptor"): the pack registers packOf(manifest)
  descriptor: {
    // no state system: a World's writes are not performed against Supabase, nor its projects observed (the gap)
    protocol: '3',
    transport: 'rest',
    archetype: 'engine-control',
    bin: 'world-supabase',
    resources: [],
    specSource: 'spec/openapi.json.gz (the Management API, api.supabase.com/api/v1-json), storage/spec/openapi.json (Storage, supabase/supabase apps/docs/spec/storage_v0_openapi.json), auth/spec/openapi.yaml (GoTrue v2.197.0) and rest/spec/client-ops.json (PostgREST, the calls @supabase/postgrest-js makes)',
    description: "Supabase twin — a project's Postgres database, the World's own managed Postgres, whose URL the credential door hands the application; the Management API, PostgREST, Storage and Auth answer the gap.",
    // Both planes' hosts, claimed so the injector refuses what the twin does not serve rather than letting it reach the
    // real Supabase: the Management API's host, and a project's data plane on `<ref>.supabase.co` at the three paths
    // the lanes answer.
    // the World's project's database URL, issued once the twin is up (./semantics/doors.ts appCredentials), under the
    // name Supabase gives it
    // source: https://supabase.com/docs/guides/functions/secrets "The URL for your Postgres database. Use it to connect directly to your database."
    credentialDoor: { path: '/_twin/app-credentials', body: {}, fill: { SUPABASE_DB_URL: 'database_url' } },
    hosts: [
      { host: 'api.supabase.com' },
      { suffix: '.supabase.co', pathPattern: '^/(rest|storage|auth)/v1(/|$)' },
    ],
    // The project's database is the World's managed Postgres (architecture.md, managed infrastructure): the runtime binds
    // its URL at boot as `serve --database <url>` (or the colocated factory's `database`), never from the environment.
    managedDatabase: {
      kind: 'postgres',
      arg: '--database',
      note: "the project's database is the World's managed postgres: the database the application's migrations and queries use, whose URL the credential door answers",
    },
    adoption: {
      pypi: ['supabase', 'gotrue', 'supabase-auth', 'postgrest', 'storage3', 'supafunc', 'realtime'],
      sdks: ['@supabase/supabase-js'],
      scopes: ['@supabase/'],
      envStems: ['SUPABASE'],
      worldIds: ['supabasemgmt'],
    },
    clientCasesNone: "The demand's application uses node-postgres over the project's native Postgres connection, not a Supabase SDK (journeys/demand.json). The customer life drives that wire; recognized Supabase SDK dependencies do not establish support for Management, Auth, Storage or PostgREST, which remain explicit gaps.",
  },
};
