// PlanetScale's dashboard and management API (the planetscale pack's `api` lane; docs/contributing/architecture.md,
// "Other wires: lanes"): app.planetscale.com, where a person makes a database, a branch's passwords and the
// organization's service tokens, and api.planetscale.com/v1, the management API, from its published Swagger document
// (../spec/openapi.json.gz; the surface ./generated/surface.gen.json).
//
// SCOPE FROM THE DEMAND (../../journeys/demand.json): the one API call an application makes is Dub's backup of `main`
// with a service token (create_backup, ./semantics/organizations.ts). Its database, its passwords and its service token come
// from the dashboard (./screens), as the applications' own setup does; every other operation of the document is the
// gap, the ones of the declared resources named `unmodeled` so the core does not answer them without a token's access.
//
// THE STATE is the vendor's (service `planetscale`), shared with psdb (the pack root reads a password to know whose
// statement it runs): organizations, databases and their branches, passwords (kept by their secret's SHA-256), service
// tokens (the same, with the accesses the settings page saves), backups.
//
// NO `auth`: PlanetScale reads a service token as `Authorization: <SERVICE_TOKEN_ID>:<SERVICE_TOKEN>`, with no scheme
// (https://planetscale.com/docs/api/reference/service-tokens), which the kernel's scheme-prefixed gate cannot state; the
// handler reads the token and its accesses.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'planetscale',
  service: 'planetscale',
  body: { json: 'always' },
  // a vendor-backed World sends the management API's calls to its own host
  // source: spec:/host "api.planetscale.com"
  remoteHost: { template: 'api.planetscale.com' },
  // PlanetScale's ids are twelve lowercase letters and digits (`jynn53mcug4l`, Dub's service token id); the twin's are
  // twelve letters
  ids: { template: '{letters:12}' },
  time: 'iso',
  // the management API's error body: `{ code, message }`
  error: { code: '{code}', message: '{message}' },
  readOnly: { status: 403, code: 'forbidden', message: 'the twin is read-only' },
  malformedBody: { status: 422, code: 'unprocessable', message: 'the request body is not JSON' },
  notFound: { status: 404, code: 'not_found', message: 'Not Found' },
  list: { style: 'envelope', envelope: { type: 'list', current_page: 1, data: '{data}' }, limit: { param: 'per_page', default: 25, max: 100 } },
  deleted: {},
  unmodeled: [
    'get_organization', 'update_organization', 'create_database', 'get_database', 'update_database_settings', 'delete_database', 'create_branch', 'get_branch', 'update_branch',
    'delete_branch', 'update_admin', 'update_backup', 'delete_backup', 'update_branch_cluster_config', 'get_default_shard_configuration_profile', 'demote_branch',
    'run_branch_maintenance', 'create_password', 'get_password', 'update_password', 'delete_password', 'renew_password', 'promote_branch', 'cancel_branch_change_request',
    'enable_safe_migrations', 'update_safe_migrations', 'disable_safe_migrations', 'get_branch_schema', 'create_shard', 'get_oauth_token', 'delete_oauth_token', 'create_oauth_token',
    'create_service_token', 'get_service_token', 'delete_service_token', 'enable_organization_sso',
  ],
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: '{ account?, deployment? }: an application\'s PlanetScale connection strings (a ready database and an admin password), as the runtime issues them' },
    { id: 'users', method: 'POST', path: '/_twin/users/{email}', note: "{ password, organization }: a person who signed up, and the organization they administer (the World's stand-in for PlanetScale's sign-up)" },
  ],
  screens: [{
    id: 'sign-in', kind: 'flow', host: 'app.planetscale.com', path: '/sign-in',
    demand: 'every dashboard page asks who is signed in', status: 'done', controls: ['Email', 'Password', 'Sign in'],
    source: 'https://planetscale.com/docs/vitess/tutorials/planetscale-quick-start-guide',
  }, {
    id: 'service-tokens', kind: 'workspace', host: 'app.planetscale.com', path: '/{organization}/settings/service-tokens',
    demand: "a service token (Dub's PLANETSCALE_SERVICE_TOKEN, for its backups) and its accesses are made only here", status: 'done',
    controls: ['New service token', 'Name', 'Save permissions'], source: 'https://planetscale.com/docs/api/reference/service-tokens',
  }, {
    id: 'database', kind: 'workspace', host: 'app.planetscale.com', path: '/{organization}/{database}',
    demand: "a branch password (the host and credentials of Dub's PLANETSCALE_DATABASE_URL) is made on a database's Connect page, and a database deleted on its settings", status: 'done',
    controls: ['Create password', 'Name', 'Role', 'Delete database'], source: 'https://planetscale.com/docs/concepts/connection-strings',
  }, {
    // the organization's home answers every other page on its host (its databases, and New database)
    id: 'organization', kind: 'workspace', host: 'app.planetscale.com', path: '/{organization}',
    demand: 'a database is made on the organization page (New database)', status: 'done',
    controls: ['New database', 'Name', 'Region', 'Cluster size', 'Create database'], source: 'https://planetscale.com/docs/vitess/tutorials/planetscale-quick-start-guide',
  }],
  resources: {
    // Each type's list (list_organizations, list_databases, list_branches, list_passwords, list_service_tokens,
    // list_backups) is the gap: no application, the life or a published example reads one, so the twin serves none and
    // a refresh has none to call
    Organization: { storedAs: 'organization', idPrefix: '', unique: [{ fields: ['name'], refusal: { status: 409, code: 'conflict', message: 'An organization with this name exists.' } }], refresh: { none: 'list_organizations is not served by the twin (no demand reads it)' } },
    Database: { storedAs: 'database', idPrefix: '', ...states.Database, unique: [{ fields: ['_organization', 'name'], refusal: { status: 409, code: 'conflict', message: 'A database with this name exists.' } }], refresh: { none: 'list_databases is not served by the twin (no demand reads it); a database is made on the dashboard' } },
    DatabaseBranch: { storedAs: 'branch', idPrefix: '', ...states.DatabaseBranch, refresh: { none: 'list_branches is not served by the twin (no demand reads it); a branch is made with its database' } },
    DatabaseBranchPassword: { storedAs: 'password', idPrefix: '', ...states.DatabaseBranchPassword, refresh: { none: "list_passwords is not served by the twin (no demand reads it), and a listed password carries no secret, which psdb's caller presents" } },
    ServiceToken: { storedAs: 'service_token', idPrefix: '', ...states.ServiceToken, refresh: { none: 'list_service_tokens is not served by the twin (no demand reads it), and a listed token carries no secret' } },
    // a backup is read back one by one (list_backups is the gap): by its organization's and database's names and its branch's,
    // which its answer does not name, kept as private fields from the parameters it was made and read under
    Backup: { storedAs: 'backup', idPrefix: '', ...states.Backup,
      parent: { params: ['organization', 'database', 'branch'], value: '{branch}', field: '_branch', resource: 'DatabaseBranch', keep: { _organization: '{organization}', _database_name: '{database}', _branch_name: '{branch}', _database: '{_database}' } },
      refresh: { get: 'get_backup', known: true, params: { organization: '{_organization}', database: '{_database_name}', branch: '{_branch_name}' } } },
    // a service token's access on a database, one subject each
    _token_access: { idPrefix: '' },
  },
};
