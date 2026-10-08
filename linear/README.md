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

## Use with an existing app

Use Node 22.6 or newer.

Install the exact twin release and World CLI in your app's folder:

```console
npm install --save-dev --save-exact @volter/world@3.0.146 @volter/twin-linear@3.0.5
./node_modules/.bin/volter world init --name my-app --twins linear --source linear=@volter/twin-linear
```

Review the selected vendor and generated bindings before starting. The World supplies synthetic credentials;
keep your app's real SDK. Read this release's modeled scope below.

```console
./node_modules/.bin/volter world up
./node_modules/.bin/volter world run -- npm test
./node_modules/.bin/volter world log
./node_modules/.bin/volter world down
```

Replace `npm test` with your app's usual command. `down` retains data, and a later `up` resumes it.
Use these installed executables from the same app folder; install there first if they are missing.
[Bring an existing app](https://world-docs.volter.ai/docs/guides/use-with-an-existing-app) explains multi-vendor selection and routing.

The app keeps its real `@linear/sdk`; the packaged customer entry pins 86.0.0.
The World's `GET /twin` describes identity, time, and the available doors.

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
