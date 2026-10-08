# @volter/twin-linear

A Protocol 3 Linear twin for a workspace’s issue-filing integration and the Linear SDK
installed by Twin ([demand](./journeys/demand.json)). It serves Linear’s GraphQL endpoint,
OAuth authorization-code installation, token refresh and configured client-credentials grants,
workspace/team/project discovery,
workflow states, issue creation/update/archive, labels and comments. The customer life and
published-example journey define the modeled scope ([decisions](./journeys/decisions.json)).

Resources are read back with declared GraphQL refresh queries, including archived issues.
Mutation deployment uses the vendored schema to adopt the resource returned by Linear.
Refresh-token retries preserve the returned pair during Linear’s documented 30-minute grace.
The executor budget stays below the documented API-key request quota.

The World’s doors represent settings/UI actions Linear’s API does not expose:
`POST /_twin/workspaces`, `POST /_twin/workspaces/{urlKey}/people`,
`POST /_twin/app-credentials` and `POST /_twin/api-keys`. The local credential door
`POST /_twin/local-credentials` uses those same settings actions to make an idempotent synthetic
starter workspace/owner, issue its personal key and register a World OAuth client. It supplies
`LINEAR_API_KEY`, `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET`; the personal key names a stored
owner and is retained across stop/resume. Teams and projects are created through the
vendor API. The authorize screen uses the registered callback and carries its state back.

The published relation, logical, date, label, comment, estimate and project-lead filters are served.
Other GraphQL fields, private-team access management, webhook configuration, PKCE and OAuth
revocation are outside this modeled scope and are refused. The SDK’s default
viewer, team and issue selections are modeled for the official SDK 86.0.0's create/update/read flow
in [the installed customer entry](./journeys/first-use.json). This does not claim every SDK method.
No webhook subscription is made by this life;
there is no invented webhook delivery. Release assessments are retained by
[the independent catalog](https://github.com/volter-ai/twin-catalog-open).

Install the selected release in your app with `npm install --save-dev @volter/twin-linear@3.0.5`.
The app keeps its real `@linear/sdk`; the packaged customer entry pins 86.0.0.
For local setup, use the app folder’s `volter world init`, review the detected vendors,
and keep Linear when the app needs it. Start with `volter world up`, run the app or seed
through `volter world run -- <command>`, and stop with `volter world down`. The World’s
`GET /twin` describes identity, time, and the available doors.

The workspace door takes `{ "name": "Example", "urlKey": "example", "owner": { "name": "Ada", "email": "ada@example.invalid", "password": "example-password" } }`.
The people door takes `{ "name", "email", "password" }`; the key door takes `{ "email", "label" }`.
The app door takes `{ "name", "redirect_uris": ["https://app.example/callback"] }`;
its optional `client_credentials: { workspace: "example", teamIds: [...] }` represents
the settings toggle and the app user’s configured team access. All credentials are synthetic.

Profiles, public-team settings, empty optional-feature state, issue relations and counts are stored
in their vendor response shapes and preserved by the declared refresh queries. `isMe` is resolved
for the current caller. Creator counts include archived issues; team counts exclude them unless
`includeArchived: true` is requested. The kernel maintains these counters on recorded writes.
The starter leaves cycles, triage, integrations, sharing and automation unconfigured. Its inactive
numeric settings, avatar colors, invitation hashes, app actor email addresses and branch naming are
explicitly synthetic choices where upstream documentation does not declare production defaults.
Mutations for those additional features remain outside scope; absent feature state does not claim
that their behavior is implemented.
