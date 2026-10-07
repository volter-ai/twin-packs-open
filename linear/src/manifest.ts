// Linear's manifest: the vendor facts its spec (../spec: Linear's GraphQL schema, and its OAuth endpoints written
// from its docs) does not carry. Linear is a GraphQL API (the kernel's GraphQL wire at api.linear.app/graphql,
// resolved by ./semantics/graphql.ts); its REST surface is OAuth's token URL. Served is what the customer’s filing integration sends
// (../journeys/demand.json). A workspace and its people are made in Linear's app (the World's doors); teams and
// projects are seeded through Linear's own API (teamCreate, projectCreate: the seeding rule).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';
import { USER_SELECTION, TEAM_SELECTION, ISSUE_SELECTION } from './semantics/shared.ts';

export const manifest: DerivedManifest = {
  vendor: 'linear',
  service: 'linear',
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'iso',
  error: { error: '{code}', error_description: '{message}' },
  readOnly: { status: 403, code: 'forbidden', message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, code: 'not_found', message: 'Not found' },
  gap: { status: 404, code: 'not_found', message: 'Not found' },
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'first', default: 50, max: 250 } },
  deleted: {},
  // source: https://linear.app/developers/graphql "https://api.linear.app/graphql"
  graphql: { paths: ['/graphql'], unmodeled: { message: 'Cannot query field "{field}" on type "{type}".', type: 'graphql error' } },
  resources: {
    organization: { idPrefix: '', refresh: {"get": "query.organization", "graphql": {"query": "query { organization { id name urlKey createdAt updatedAt userCount } }", "items": "data.organization"}} },
    user: { idPrefix: '', counts: { createdIssueCount: { of: 'issue', by: 'creator.id' } }, refresh: {"list": "query.users", "graphql": {"query": `query($after: String) { users(first: 250, after: $after) { nodes { ${USER_SELECTION} } pageInfo { hasNextPage endCursor } } }`, "items": "data.users.nodes", "pageInfo": "data.users.pageInfo"}}, parent: {"resource": "organization", "field": "_org", "param": "id"} },
    team: { idPrefix: '', counts: { issueCount: { of: 'issue', by: 'team.id', absent: 'archivedAt' }, _totalIssueCount: { of: 'issue', by: 'team.id' } }, refresh: {"list": "query.teams", "graphql": {"query": `query($after: String) { teams(first: 250, after: $after) { nodes { ${TEAM_SELECTION} } pageInfo { hasNextPage endCursor } } }`, "items": "data.teams.nodes", "pageInfo": "data.teams.pageInfo"}}, parent: {"resource": "organization", "field": "_org", "param": "id"} },
    workflow_state: { embeds: { _team: 'team' }, idPrefix: '', refresh: {"list": "query.workflowStates", "graphql": {"query": "query($id: ID!, $after: String) { workflowStates(first: 250, after: $after, filter: {team: {id: {eq: $id}}}) { nodes { id name type color position createdAt updatedAt } pageInfo { hasNextPage endCursor } } }", "variables": {"id": "{id}"}, "items": "data.workflowStates.nodes", "pageInfo": "data.workflowStates.pageInfo"}}, parent: {"resource": "team", "field": "_team", "param": "id"}, ...states.workflow_state },
    project: { embeds: { _lead: 'user' }, ...states.project, idPrefix: '', refresh: {"list": "query.projects", "graphql": {"query": "query($after: String) { projects(first: 250, after: $after) { nodes { id name description state lead { id } createdAt updatedAt teams { nodes { id } } } pageInfo { hasNextPage endCursor } } }", "items": "data.projects.nodes", "pageInfo": "data.projects.pageInfo"}}, parent: {"resource": "organization", "field": "_org", "param": "id"} },
    issue: { embeds: { _state: 'workflow_state', _project: 'project', _assignee: 'user', _creator: 'user' }, idPrefix: '', refresh: {"list": "query.issues", "graphql": {"query": `query($id: ID!, $after: String) { issues(first: 250, after: $after, includeArchived: true, filter: {team: {id: {eq: $id}}}) { nodes { ${ISSUE_SELECTION} } pageInfo { hasNextPage endCursor } } }`, "variables": {"id": "{id}"}, "items": "data.issues.nodes", "pageInfo": "data.issues.pageInfo"}}, parent: {"resource": "team", "field": "_team", "param": "id"}, ...states.issue },
    comment: { embeds: { _user: 'user' }, idPrefix: '', refresh: {"list": "query.issue", "graphql": {"query": "query($id: String!, $after: String) { issue(id: $id) { comments(first: 250, after: $after) { nodes { id body createdAt updatedAt user { id } } pageInfo { hasNextPage endCursor } } } }", "variables": {"id": "{id}"}, "items": "data.issue.comments.nodes", "pageInfo": "data.issue.comments.pageInfo"}}, parent: {"resource": "issue", "field": "_issue", "param": "id"} },
    issue_label: { embeds: { _team: 'team' }, idPrefix: '', refresh: {"list": "query.issueLabels", "graphql": {"query": "query($after: String) { issueLabels(first: 250, after: $after) { nodes { id name color description createdAt team { id } } pageInfo { hasNextPage endCursor } } }", "items": "data.issueLabels.nodes", "pageInfo": "data.issueLabels.pageInfo"}}, parent: {"resource": "organization", "field": "_org", "param": "id"} },
    _browser_session: { idPrefix: 'bs_', ids: '{prefix}{n}' },
    _app: { idPrefix: '' },
    _code: { idPrefix: 'code_', ids: '{prefix}{n}' },
    _access_token: { idPrefix: 'at_', ids: '{prefix}{n}' },
    _refresh_token: { idPrefix: 'rt_', ids: '{prefix}{n}' },
  },
  // source: https://linear.app/developers/rate-limiting "2,500"
  rateBudget: { windowMs: 60_000, ceiling: 40, defaultWeight: 1,
    reason: '40 requests per minute stays below the API-key quota of 2,500 per hour (OAuth permits more).',
    allowance: { perMinute: 41.666666666666664, source: 'https://linear.app/developers/rate-limiting' } },
  unmodeled: ['oauthRevoke'],
  screens: [{
    id: 'authorize', kind: 'flow', host: 'linear.app', path: '/oauth/authorize',
    demand: 'the customer’s filing integration connects a workspace (response_type code, scopes, actor=app, prompt=consent)', status: 'done',
    controls: ['Log in', 'Authorize', 'Cancel'], source: 'https://linear.app/developers/oauth-2-0-authentication',
  }],
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: '{ name?, redirect_uris?, client_credentials?: { workspace, teamIds } }: an OAuth application made in Linear\'s settings: its client id and secret' },
    { id: 'workspaces', method: 'POST', path: '/_twin/workspaces', note: '{ name, urlKey, owner: { name, email, password } }: a workspace made in Linear\'s app, its first person its admin' },
    { id: 'people', method: 'POST', path: '/_twin/workspaces/{urlKey}/people', note: '{ name, email, password }: a person joins the workspace' },
    { id: 'apiKeys', method: 'POST', path: '/_twin/api-keys', note: "{ email, label? }: a person's personal API key, made in Linear's settings (answered once)" },
    { id: 'localCredentials', method: 'POST', path: '/_twin/local-credentials', note: "{}: an idempotent synthetic starter workspace/owner, its retained personal key, and a World OAuth client; uses the same workspace and key settings actions" },
  ],
  discovery: {
    twinOf: "Linear's GraphQL API as the customer’s filing integration uses it (teams, workflow states, projects, issues, comments, labels) and its OAuth app install",
    stores: 'workspaces with their people, teams, workflow states, projects, labels, issues and comments; OAuth applications, codes and tokens (by their SHA-256)',
    identity: '`Authorization: Bearer <OAuth access token>` or a person’s raw `lin_api_` API key',
  },
  descriptor: {
    protocol: '3',
    transport: 'graphql',
    archetype: 'crud',
    bin: 'world-linear',
    resources: ['organization', 'user', 'team', 'workflow_state', 'project', 'issue', 'comment', 'issue_label'],
    specSource: "Linear's GraphQL schema (linear/linear packages/sdk/src/schema.graphql) and its OAuth endpoints written from its docs (spec/SOURCE.md)",
    description: "Linear twin — its GraphQL API (teams, workflow states, projects, issues, comments, labels) and OAuth app install, as the customer’s filing integration files and tracks issues.",
    adoption: { sdks: ['@linear/sdk'], envStems: ['LINEAR'] },
    hosts: [{ host: 'api.linear.app' }, { host: 'linear.app', pathPattern: '^/oauth/' }],
    endpointEnvNone: 'Linear uses api.linear.app/graphql and linear.app/oauth/authorize; the World claims the documented hosts',
    credentialDoor: { path: '/_twin/local-credentials', body: {}, fill: { LINEAR_CLIENT_ID: 'client_id', LINEAR_CLIENT_SECRET: 'client_secret', LINEAR_API_KEY: 'api_key' } },
  },
};
