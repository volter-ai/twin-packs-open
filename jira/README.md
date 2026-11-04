# @volter/twin-jira

Jira Cloud for the on-call agent's jira.js client and an OAuth issue-tracking integration.
The measured caller and retained story scope are in journeys/demand.json and journeys/decisions.json.

The auth lane serves Atlassian OAuth authorization, JSON token exchange, rotating refresh tokens,
accessible sites, and the authorize page. The platform lane serves REST v3 projects, components,
issue creation and field projection, ADF comments, label edits, simple workflow transitions,
the current user's base profile, assignable users and the measured JQL subset. Basic email/API-token authentication works on a
site's atlassian.net URL; OAuth uses api.atlassian.com/ex/jira/{cloudId}.

Bootstrap a site with POST /_twin/sites and JSON
`{ "name": "acme", "admin": { "name": "Agent", "email": "agent@acme.example", "password": "world-password" } }`.
The response contains `cloudid`, `url` and `admin` (the account ID) (the project lead).
POST /_twin/api-token with `{ "site": "acme", "email": "agent@acme.example", "password": "world-password" }`
returns `apiToken` and the complete `authorization` header for jira.js's Basic authentication.
`GET /rest/api/3/myself` reads that authenticated person's `accountId`; use it as
`leadAccountId` when creating a project. Group and application-role expansion are outside this pack's scope.
Invite a person with POST /_twin/sites/acme/people and `{ "name", "email", "password" }`.
These doors are declared on the auth lane manifest; the root discovery endpoint does not aggregate lane doors.

World doors stand for site/account signup, people invited to the site, app registration, and
API-token creation in the account console. The credential door fills JIRA_API_TOKEN for the
cookbook's account; explicit integrations register their callbacks and obtain OAuth credentials
through /_twin/app-credentials. Stored API resources declare refresh, including detail reads for
paged project summaries. Vendor fields are stored in their response shape and read through the
kernel view.

The default workflow is To Do, In Progress, Done. This pack omits workflow customization,
Compass integration, attachments, worklogs, custom-field configuration, board editing and
undocumented token revocation. Unsupported operations are the manifest's literal unmodeled
list; unsupported JQL is refused in Jira's error form. Plain-text descriptions on the REST v3 wire are refused; jira.js versions that normalize
strings to ADF can accept a string at the SDK boundary. Published examples requiring omitted
configuration are individually accounted for in journeys/vendor-examples.json.

The authorize page is the connected browser flow this integration uses. Jira's board editor
is outside the measured integration flow; this package does not reproduce it.
