// Jira's manifest: a vendor of two APIs, each a lane (architecture, "Other wires: lanes"): Atlassian's OAuth 2.0 (3LO)
// (`auth`: the authorize page and token URL on auth.atlassian.com, and accessible-resources on api.atlassian.com) and
// the Jira Cloud platform REST API v3 (`platform`: at api.atlassian.com/ex/jira/{cloudid}, or a site's own host).
// The current demand and retained integration scope are in ../journeys/demand.json.
import type { VendorManifest } from '@volter/world-core';

export const manifest: VendorManifest = {
  vendor: 'jira',
  discovery: {
    twinOf: "Jira Cloud for the on-call agent and an OAuth issue-tracking integration: Atlassian's OAuth 2.0 (3LO) install and the platform REST API v3 (projects, issues, JQL search, comments, transitions, labels, components, assignable users)",
    stores: "sites and their people, OAuth apps, codes and tokens (by their SHA-256), projects with their issue types, workflow and components, issues and their comments",
  },
  lanes: {
    routes: [
      { lane: 'auth', host: '^auth\\.atlassian\\.com$' },
      { lane: 'auth', host: '^api\\.atlassian\\.com$', path: '/oauth' },
      { lane: 'platform', host: '^(api\\.atlassian\\.com|[a-z0-9-]+\\.atlassian\\.net)$' },
    ],
    default: 'platform',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-jira',
    resources: ['project', 'issue', 'comment', 'component'],
    specSource: "the Jira Cloud platform REST API v3 document (platform/spec/SOURCE.md) and Atlassian's 3LO endpoints written from its docs (auth/spec/SOURCE.md)",
    description: "Jira twin — Atlassian's OAuth 2.0 (3LO) and the Jira Cloud REST API v3 (projects, issues, JQL search, comments, transitions, labels, components), for on-call filing and issue tracking.",
    adoption: { sdks: ['jira.js', 'jira-client'], envStems: ['JIRA', 'ATLASSIAN'] },
    hosts: [{ host: 'auth.atlassian.com' }, { host: 'api.atlassian.com', pathPattern: '^/(oauth/|ex/jira/)' }, { suffix: '.atlassian.net' }],
    endpointEnvNone: 'The on-call agent uses its site URL; the OAuth flow uses auth.atlassian.com and api.atlassian.com, all claimed by the World',
    credentialDoor: { account: { field: 'account', tenancy: 'Atlassian person with site membership', source: 'https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/' }, deployment: { field: 'deployment', object: 'Named personal API token', source: 'https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/' }, path: '/_twin/api-token', body: {}, fill: { JIRA_API_TOKEN: 'apiToken', JIRA_EMAIL: 'email', JIRA_URL: 'url' } },
  },
};
