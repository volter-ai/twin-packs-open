# linear spec — provenance

- **GraphQL:** `schema.graphql.gz`, gzip of Linear's published schema, https://github.com/linear/linear
  `packages/sdk/src/schema.graphql` on `master` at `2a3ac4cfd28a` (committed 2026-09-28, fetched 2026-09-30); the API
  is served at https://api.linear.app/graphql. SHA-256 of the uncompressed schema: `cc4263f66d6e79f188b1e6b08af5f0fe8dd32dd3c0cdae3c070606e8d1e5e0eb`.
- **OAuth:** `openapi.json`, written from https://linear.app/developers/oauth-2-0-authentication (Linear publishes no
  OpenAPI document): the token URL and the revoke URL. The authorize page (linear.app/oauth/authorize) is a screen.
  SHA-256: `5ee78cc5a9fd3d614f96150ccc8c63d5d75e540a09c35b93ca6515e9d7691d29`.
- **Corrections:** none.
- **Read:** from the vendored SDL and the linked reference pages.

- **Documented examples:** `doc-examples.json`, transcribed from the published GraphQL,
  pagination, filtering and OAuth pages on 2026-10-01; placeholder ids are replaced with
  captured API ids in the replay. Out-of-scope selected fields and grant modes are recorded
  with their reason in `journeys/vendor-examples.json`.
- **Additional pages read:** https://linear.app/developers/pagination,
  https://linear.app/developers/filtering, https://linear.app/developers/rate-limiting,
  https://linear.app/developers/webhooks and
  https://linear.app/developers/oauth-actor-authorization. The current life does not configure
  a webhook; it uses the documented app actor and token retry grace.

Published actor issue creation is transcribed in `doc-examples.json` from https://linear.app/developers/oauth-actor-authorization (read 2026-10-01); its literal team id is replaced by a captured World id in the replay.

The official SDK 86.0.0's unchanged User, Team and Issue fragments are read alongside this pinned SDL.
The installed customer entry follows https://linear.app/developers/sdk-fetching-and-modifying-data.
Profile initials and profile URL forms are read from https://linear.app/docs/profile and
https://linear.app/docs/members-roles; team opt-in features are read from https://linear.app/docs/teams
and https://linear.app/docs/use-cycles. These pages do not establish the starter's inactive numeric
settings, avatar palette, invitation hashes, app actor email or branch template; those values are
labeled synthetic in the shared model and package README rather than asserted as vendor defaults.

Screen references, read 2026-10-08: [Linear's OAuth guide](https://linear.app/developers/oauth-2-0-authentication) supplies scopes, consent outcomes and redirects. [Rivet's firsthand integration walkthrough](https://rivet.dev/blog/2025-05-28-building-linear-agents-in-node-js-and-rivet-full-walkthrough-and-starter-kit/), published 2025-05-28, supplies its auth-linear.png consent-page layout. The authored page names the actual application, workspace and requested scopes. Team selection is outside this screen's existing grant scope; it presents the authenticated workspace without inventing additional grants. No upstream image, markup or scripts are shipped.

Workspace references, read and their public screenshots viewed 2026-10-09 by
`/root/journey_evidence_finish`: [My issues](https://linear.app/docs/my-issues),
[Assign and delegate issues](https://linear.app/docs/assigning-issues),
[Issue properties](https://linear.app/docs/issue-property) and
[Issues](https://linear.app/docs/creating-issues). The first screenshot supplies the dark
workspace/sidebar, view tabs and grouped identifier/title rows. The assignment screenshot
supplies the issue body and right-hand properties panel; the article establishes one assignee
and No assignee. Issue properties establishes team-specific workflows and automatic-only
archiving. Exact public image URLs and the authored browser scope are recorded in
[screen-references.json](./screen-references.json). Upstream image/page publication dates
are not established. No vendor login was used and no upstream image, markup or script is
shipped. The declared source workflow is not a released browser-walk receipt.

SHA-256 of the authored `screen-references.json`:
`83d9c33f674cb663b291f251cd7ceae15b3cbb7919044d0fcb41a57b4f61e6ba`.

Where these public pages do not specify an address, the workspace routes are the authored
screen's explicit paths; issue detail preserves the native `url` path already emitted by
`issueCreate`. Password sign-in remains the pack's existing synthetic identity mechanism,
not a claim about Linear's current production authentication choices. The browser reuses
existing stored rows and mutation refusals; the references do not enlarge the pack's modeled
private-team or suspended-user permission rules.

The unchanged SDK 86.0.0's default `Organization` query selects its workspace model plus
`ProjectStatus`, `PaidSubscription` and the linked integration id. These field names,
nullability and enum values come from the same pinned SDL, including nullable
`ProjectStatus.description`. The organization records its synthetic unconfigured settings,
empty project-status list and absence of a paid subscription/integration; observed nested
vendor shapes remain readable as stored. The kernel maintains the organization's issue count
from stored issue ownership. This selection support does not implement project-status,
subscription, authentication-provider or organization-settings mutations. Retained synthetic
starter records acquire only missing unconfigured fields through the existing settings door;
existing stored values are preserved. The SDK query is not narrowed.

The unchanged SDK's `issue.state` relation performs `Query.workflowState(id: String!)`.
That pinned-SDL root resolves the existing workspace/team-scoped workflow-state resource,
with the same authentication, identifier alias and Entity not found refusals as other
entity reads. The SDK's default WorkflowState fragment also selects nullable description,
archive time and inherited-parent id, plus the stored team's id. New synthetic team states
record absent description, archive and inheritance as null; refresh preserves these native
fields when observed. This does not add workflow creation, inheritance or archive actions.

The unchanged SDK's `issue.assignee` relation performs `Query.user(id: String!)`, whose
pinned-SDL argument names the user identifier. This root reads the existing workspace
user resource through native identifier aliases, preserving authentication and Entity not found
refusals; the existing default User fields and current-caller `isMe` resolver remain unchanged.
It adds no membership, invitation, profile mutation or broader permission behavior.
