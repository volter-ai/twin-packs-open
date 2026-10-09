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

The browser workspace at `linear.app/` uses the same stored person and `linear_session`
cookie as OAuth consent. Sign in with the synthetic email/password supplied to the workspace
or people door. The local credential starter uses `owner@linear-world.invalid` and
`world-linear-local-password`; these are the existing synthetic settings inputs, not vendor
credentials. After sign-in the browser opens the first stored team by name. Workspace and
issue addresses use the stored organization `urlKey`, team `key` and issue `identifier`.

The team view (`/{urlKey}/team/{key}/all`) lists that team's actual nonarchived issues,
grouped by their stored workflow states. Filter by title or identifier and open a row at
`/{urlKey}/issue/{identifier}`. The detail shows its title, Markdown description, state,
priority, assignee, team, recorded dates and stored comments. Change the status or choose
one assignee (including No assignee) and press Save properties. The form calls the same
`issueUpdate` action as GraphQL and rereads the stored row after its redirect; unknown
objects, states from another team and unsupported form actions are refused. My issues
provides Assigned and Created views from the stored assignee and creator relations.
People and assignees appear by their stored names; the browser does not synthesize avatar art.

The public [My issues](https://linear.app/docs/my-issues) and
[assignment](https://linear.app/docs/assigning-issues) screenshots guide the sidebar,
issue rows and right properties panel. [Screen references](./spec/screen-references.json)
records the exact images, read date, author and declared workflow. This basic browser does
not implement Subscribed/Activity tabs, curated SLA/cycle/blocker ordering, keyboard
shortcuts, board drag/drop, browser issue creation, editable descriptions or comment posting.
Private-team membership and suspended-user assignment enforcement remain outside the
existing pack permission scope. Archived issues are hidden from lists and can be read at
their known detail address; no manual archive control is presented. OAuth consent remains
a separate screen and uses the registered application and callback.

The published relation, logical, date, label, comment, estimate and project-lead filters are served.
Other GraphQL fields, private-team access management, webhook configuration, PKCE and OAuth
revocation are outside this modeled scope and are refused. The SDK’s default
viewer, team and issue selections are modeled for the official SDK 86.0.0's create/update/read flow
in [the installed customer entry](./journeys/first-use.json). This does not claim every SDK method.
No webhook subscription is made by this life;
there is no invented webhook delivery. Release assessments are retained by
[the independent catalog](https://github.com/volter-ai/twin-catalog-open).

The SDK's unchanged default Organization selection also reads the stored workspace settings,
including native nested ProjectStatus/PaidSubscription fields when present. The synthetic
starter has no configured project-status records, paid subscription, Slack project integration,
customer feature or AI/reminder service. Its inactive settings are explicitly synthetic; empty
or nullable state does not implement those features' mutations. The existing local credential
door fills only previously absent starter settings on resume and preserves stored values.
The kernel maintains the workspace's created issue count from actual issue ownership.

The SDK's normal `issue.state` lookup reads the existing workflow-state resource by id,
with its native description, archive time, inherited-parent id and team relation. Nullable
values stay absent/null on the synthetic new-team states, and refresh preserves observed
native values. The lookup uses the existing workspace/team visibility and Entity not found
refusals; it does not add workflow creation, inheritance or archive controls.
The normal `issue.assignee` lookup reads that user's existing native stored profile through
`user(id)`, with the same workspace visibility, authentication and Entity not found refusal.
The default User fields and current-caller `isMe` behavior are shared with `viewer`; this
adds no membership, invitation or profile mutation.

## Use with an existing app

Use Node 22.6 or newer.

Install the exact twin release and World CLI in your app's folder:

```console
npm install --save-dev --save-exact @volter/world@3.0.147 @volter/twin-linear@3.0.6
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
