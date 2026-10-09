// GitHub's manifest: the vendor facts its published REST description does not carry (docs/contributing/architecture.md,
// "Protocol 3"). The surface is generated (./generated/surface.gen.json, from ../spec by scripts/derive-pack.ts), each
// operation in the family its first tag names (spec/grouping.json); GitHub's GraphQL schema beside it
// (./generated/graphql-sdl.gen.json) is the same state over a second wire (./semantics/graphql.ts).
//
// Every resource is stored in GitHub's own answer's shape, under the schema name the surface gives it; the derived core
// serves its plain reads and writes, and the handlers (./semantics/<family>.ts) what data cannot say. A repository's
// children live under it by `_repo` (its owner and name, as the path names them), a numbered child (an issue, a
// milestone, an alert) is named by its number through `_n`, and GitHub's `node_id` is its legacy global id, base64 of
// `0<length>:<Type><id>`.
//
// THE WORLD'S GITHUB. People and their accounts exist outside the World: a person is known the first time the World names
// them (an invitation, a door). A person acts with a token the World issued them: one they make on their settings page
// (the World's door) holds the scopes they chose; an OAuth app's or a GitHub App's acts as its grant says. A repository's code is a git repository of the World (`ctx.git`), pushed to and cloned over smart
// HTTP at `/<owner>/<repo>.git` (./screens/git.ts).
import type { DerivedManifest } from '@volter/world-core';
import { data, values } from './semantics/events.ts';
import { states } from './semantics/states.ts';

/** A repository's child: under its repository by its full name (around.ts has spelled the path as the repository's). */
const underRepo = { params: ['owner', 'repo'], value: '{owner}/{repo}', field: '_repo', resource: 'full-repository', where: { full_name: '{owner}/{repo}' } };
/** A repository's child named by its number (`_n`, the number as the path names it). */
const numbered = { alternateKeys: ['_n'] };

export const manifest: DerivedManifest = {
  vendor: 'github',
  service: 'github',
  // GitHub reads a write's body as JSON whatever its content type says (where the documentation stops: the pages name only
  // JSON bodies, which gh and the SDKs send without a content type)
  // source: https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api "If you send invalid JSON in the request body, you may receive a 400 Bad Request response and a "Problems parsing JSON" error message."
  body: { json: 'always' },
  ids: { template: '{prefix}{n}' },
  time: 'iso',
  // "path" in a contents route, a branch, and a ref hold slashes (`.github/workflows/ci.yml`, `deps/minimist`)
  spanning: ['path', 'ref', 'branch'],
  error: { message: '{message}', documentation_url: 'https://docs.github.com/rest', status: '{statusText}' },
  errorOmitsAbsent: true,
  readOnly: { status: 403, message: 'twin is read-only; omit readOnly to accept writes' },
  notFound: { status: 404, message: 'Not Found' },
  gap: { status: 404, message: 'Not Found' },
  deleted: null,
  // GitHub's lists answer a bare array, paged by `page` and `per_page` (30, at most 100) with the `Link` header naming the pages
  // source: https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api "For example, GET /repos/octocat/Spoon-Knife/issues will only return 30 issues"
  // source: https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api "For most endpoints, the maximum value of per_page is 100 ."
  // source: https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api "When a response is paginated, the response headers will include a link header."
  list: { style: 'envelope', envelope: '{data}', limit: { param: 'per_page', default: 30, max: 100 }, page: { param: 'page', link: true } },
  // operations of declared resources no application of ours calls, no step of the life reaches and the twin does not serve:
  // each answers GitHub's Not Found (the gap)
  unmodeled: [
    "actions/approve-workflow-run", "actions/cancel-workflow-run", "actions/delete-artifact", "actions/delete-environment-secret", "actions/delete-environment-variable", "actions/delete-repo-secret",
    "actions/delete-repo-variable", "actions/delete-workflow-run", "actions/get-artifact", "actions/get-environment-secret", "actions/get-environment-variable", "actions/get-job-for-workflow-run",
    "actions/get-repo-secret", "actions/get-repo-variable", "actions/get-workflow", "actions/get-workflow-run", "actions/get-workflow-run-attempt", "actions/list-environment-variables",
    "actions/list-jobs-for-workflow-run", "actions/list-jobs-for-workflow-run-attempt", "actions/list-repo-organization-secrets", "actions/list-repo-organization-variables", "actions/list-repo-secrets", "actions/list-selected-repositories-enabled-github-actions-organization",
    "actions/list-selected-repositories-self-hosted-runners-organization", "actions/list-workflow-run-artifacts", "actions/re-run-workflow", "activity/list-repos-starred-by-authenticated-user", "activity/list-watchers-for-repo",
    "agents/delete-repo-secret", "agents/delete-repo-variable", "agents/get-repo-secret", "agents/get-repo-variable", "agents/list-repo-organization-secrets", "agents/list-repo-organization-variables",
    "agents/list-repo-secrets", "agents/list-repo-variables", "apps/delete-installation", "apps/get-authenticated", "apps/get-by-slug", "apps/get-installation",
    "apps/get-org-installation", "apps/get-user-installation", "apps/list-installation-repos-for-authenticated-user", "apps/list-installations", "apps/list-installations-for-authenticated-user", "apps/list-repos-accessible-to-installation",
    "checks/create", "checks/get", "checks/list-for-ref", "checks/list-for-suite", "checks/update", "codespaces/pre-flight-with-repo-for-authenticated-user",
    "interactions/get-pull-request-bypass-list-for-repo", "issues/add-blocked-by-dependency", "issues/add-labels", "issues/add-sub-issue",
    "issues/create-label", "issues/delete-comment", "issues/delete-label", "issues/delete-milestone", "issues/get-comment",
    "issues/get-label", "issues/get-milestone", "issues/get-parent", "issues/list", "issues/list-assignees", "issues/list-dependencies-blocked-by",
    "issues/list-dependencies-blocking", "issues/list-for-authenticated-user", "issues/list-for-org", "issues/list-labels-for-milestone", "issues/list-labels-on-issue", "issues/list-sub-issues",
    "issues/remove-dependency-blocked-by", "issues/remove-label", "issues/update-label", "issues/update-milestone", "orgs/delete", "orgs/list-app-installations",
    "orgs/list-blocked-users", "orgs/list-members", "orgs/list-memberships-for-authenticated-user", "orgs/list-outside-collaborators", "orgs/list-public-members", "orgs/remove-membership-for-user",
    "orgs/set-membership-for-user", "orgs/update", "orgs/update-membership-for-authenticated-user", "pulls/delete-pending-review",
    "pulls/get-review", "pulls/list-reviews", "pulls/update", "pulls/update-review", "repos/add-app-access-restrictions", "repos/add-user-access-restrictions",
    "repos/create-org-ruleset", "repos/delete", "repos/delete-an-environment", "repos/delete-deploy-key", "repos/delete-org-ruleset", "repos/delete-release",
    "repos/delete-release-asset", "repos/delete-repo-ruleset", "repos/delete-webhook", "repos/get-apps-with-access-to-protected-branch", "repos/get-deploy-key", "repos/get-deployment-branch-policy",
    "repos/get-environment", "repos/get-org-ruleset", "repos/get-org-rulesets", "repos/get-release", "repos/get-repo-ruleset", "repos/get-users-with-access-to-protected-branch",
    "repos/get-webhook", "repos/list-commit-statuses-for-ref", "repos/list-pull-requests-associated-with-commit", "repos/update-deployment-branch-policy", "repos/update-org-ruleset", "repos/update-release",
    "repos/update-release-asset", "repos/update-webhook", "security-advisories/get-repository-advisory", "security-advisories/list-org-repository-advisories", "teams/delete-in-org", "teams/delete-legacy",
    "teams/get-legacy", "teams/update-in-org", "teams/update-legacy", "users/add-email-for-authenticated-user", "users/list", "users/list-blocked-by-authenticated-user",
    "users/list-followed-by-authenticated-user", "users/list-followers-for-authenticated-user", "users/list-followers-for-user", "users/list-following-for-user", "users/list-public-emails-for-authenticated-user",
  ],
  resources: {
    // accounts: a person or an organization is refreshed by its own read (the World keeps accounts by their login)
    'private-user': { storedAs: 'user', idPrefix: '', alternateKeys: ['login'], refresh: { none: 'accounts are kept by their login, and a read names an account by its numeric id: the root\'s own is read with users/get-authenticated as it signs in' } },
    'public-user': { storedAs: 'user', idPrefix: '', alternateKeys: ['login'], refresh: { none: 'an account other than the root\'s own is read one login at a time (users/get-by-username); the root\'s is private-user\'s' } },
    'simple-user': { storedAs: 'user', idPrefix: '', alternateKeys: ['login'], refresh: { none: 'the form other objects embed an account in, read with them' } },
    email: { storedAs: 'user_email', idPrefix: '', refresh: { none: 'an address has no id of its own (the World keeps it as <login>::<email>); the root reads its own with users/list-emails-for-authenticated-user' } },
    // the numbered id each account is given (accounts are kept by their login)
    _account: { idPrefix: '' },
    // each credential, session and code the World issues draws its own numbered subject (ids from the tree)
    _serial: { idPrefix: '' },
    'organization-full': { storedAs: 'org', idPrefix: '', alternateKeys: ['login'], ...states['organization-full'], refresh: { none: 'an organization is read by its login (orgs/get); the root reads those it belongs to with its memberships' } },
    'org-membership': { storedAs: 'org_membership', idPrefix: '', ...states['org-membership'], refresh: { none: 'a membership has no id of its own (the World keeps it as <org>::<login>, which an item names only nested); orgs/list-memberships-for-authenticated-user reads the root\'s' } },
    'team-full': { storedAs: 'team', idPrefix: '', alternateKeys: ['slug'], ...states['team-full'], refresh: { list: 'teams/list-for-authenticated-user' } },
    // repositories and what lives under them
    'full-repository': { storedAs: 'repository', idPrefix: '', alternateKeys: ['full_name'], ...states['full-repository'], refresh: { none: 'the same repositories as repository, which lists them' } },
    repository: { storedAs: 'repository', idPrefix: '', alternateKeys: ['full_name'], ...states['repository'], refresh: { list: 'repos/list-for-authenticated-user' } },
    // source: spec:issues/list-labels-for-repo "Lists all labels for a repository."
    label: { order: { field: 'id', direction: 'asc' }, idPrefix: '', parent: underRepo, alternateKeys: ['name'], assigned: { node_id: { template: '05:Label{id}', encode: 'base64' }, url: { template: 'https://api.github.com/repos/{_repo}/labels/{name}' }, default: { value: false } }, refresh: { list: 'issues/list-labels-for-repo' } },
    milestone: { idPrefix: '', parent: underRepo, ...numbered, filters: ['state'], ...states['milestone'], refresh: { list: 'issues/list-milestones' } },
    issue: { idPrefix: '', parent: underRepo, ...numbered, ...states['issue'], refresh: { list: 'issues/list-for-repo' } },
    'issue-comment': { storedAs: 'issue_comment', idPrefix: '', parent: underRepo, ...states['issue-comment'], refresh: { list: 'issues/list-comments-for-repo' } },
    // source: spec:/components/schemas/pull-request/properties/_links "self"
    'pull-request': { vendorUnderscored: ['_links'], storedAs: 'pull', idPrefix: '', parent: underRepo, ...numbered, ...states['pull-request'], refresh: { none: 'the same pull requests as pull-request-simple, which lists them' } },
    // source: spec:/components/schemas/pull-request-simple/properties/_links "self"
    'pull-request-simple': { vendorUnderscored: ['_links'], storedAs: 'pull', idPrefix: '', parent: underRepo, ...numbered, ...states['pull-request-simple'], refresh: { list: 'pulls/list' } },
    // source: spec:/components/schemas/pull-request-review/properties/_links "html"
    'pull-request-review': { vendorUnderscored: ['_links'], storedAs: 'review', idPrefix: '', parent: underRepo, ...states['pull-request-review'], refresh: { none: "a review is listed per pull request (pulls/list-reviews), under a parent the path names by a number, not a stored id" } },
    status: { storedAs: 'commit_status', idPrefix: '', parent: underRepo, ...states['status'], refresh: { none: "a status is listed per commit (repos/list-commit-statuses-for-ref), under a sha, not a stored subject" } },
    release: { idPrefix: '', parent: underRepo, cascade: [{ resource: 'release-asset', field: '_release' }], ...states['release'], refresh: { list: 'repos/list-releases' } },
    'release-asset': { storedAs: 'release_asset', idPrefix: '', parent: { param: 'release_id', field: '_release', resource: 'release' }, ...states['release-asset'], refresh: { list: 'repos/list-release-assets' } },
    hook: { storedAs: 'repo_hook', idPrefix: '', parent: underRepo, ...states['hook'], refresh: { list: 'repos/list-webhooks' } },
    'deploy-key': { storedAs: 'deploy_key', idPrefix: '', parent: underRepo, refresh: { list: 'repos/list-deploy-keys' } },
    // source: spec:/components/schemas/repository-ruleset/properties/_links "self"
    'repository-ruleset': { vendorUnderscored: ['_links'], storedAs: 'repository_ruleset', idPrefix: '', parent: underRepo, ...states['repository-ruleset'], refresh: { list: 'repos/get-repo-rulesets', complete: false } },
    environment: { idPrefix: '', parent: underRepo, refresh: { list: 'repos/get-all-environments', items: 'environments' } },
    'deployment-branch-policy': {
      storedAs: 'deployment_branch_policy', idPrefix: '', ...states['deployment-branch-policy'],
      parent: { params: ['owner', 'repo', 'environment_name'], value: '{owner}/{repo}/{environment_name}', field: '_environment', resource: 'environment', where: { _repo: '{owner}/{repo}', name: '{environment_name}' } },
      refresh: { list: 'repos/list-deployment-branch-policies', items: 'branch_policies' },
    },
    'actions-variable': { storedAs: 'repo_variable', idPrefix: '', parent: underRepo, key: '{owner}/{repo}::{name}', refresh: { list: 'actions/list-repo-variables', items: 'variables' } },
    // a repository's secrets (an environment's are kept beside them as environment_secret, read with their environment)
    'actions-secret': { storedAs: 'repo_secret', idPrefix: '', refresh: { none: "a secret's value is write-only: the API lists names and dates, never what was sealed" } },
    // what a run's steps uploaded, reported by the runner door that completes the run
    artifact: { idPrefix: '', parent: underRepo, refresh: { list: 'actions/list-artifacts-for-repo', items: 'artifacts' } },
    // a push GitHub reports (the `push` event's payload), not a REST schema
    push: { idPrefix: '', refresh: { none: 'a push is an event GitHub sends, not state it lists' } },
    // discussions (GraphQL's; the `discussion` webhook's payload shape) and their comments
    discussion: { idPrefix: '', parent: underRepo, refresh: { none: 'discussions have no REST API: GraphQL reads them (repository.discussions)' } },
    'discussion-comment': { storedAs: 'discussion_comment', idPrefix: '', refresh: { none: 'discussions have no REST API: GraphQL reads their comments' } },
    // Actions: what a push of a workflow file sets off
    workflow: { idPrefix: '', parent: underRepo, ...states['workflow'], refresh: { list: 'actions/list-repo-workflows', items: 'workflows' } },
    'workflow-run': { storedAs: 'workflow_run', idPrefix: '', parent: underRepo, ...states['workflow-run'], refresh: { list: 'actions/list-workflow-runs-for-repo', items: 'workflow_runs', complete: false } },
    job: { storedAs: 'workflow_job', idPrefix: '', ...states['job'], refresh: { none: "a job is listed per workflow run (actions/list-jobs-for-workflow-run), under a run's number, not a stored subject" } },
    'check-run': { storedAs: 'check_run', idPrefix: '', parent: underRepo, ...states['check-run'], refresh: { none: 'a check run is listed per ref (checks/list-for-ref), not per repository' } },
    'repository-advisory': { storedAs: 'repository_advisory', idPrefix: '', idAs: 'ghsa_id', parent: underRepo, filters: ['state'], ...states['repository-advisory'], refresh: { list: 'security-advisories/list-repository-advisories' } },
    // Apps
    integration: { storedAs: 'app', idPrefix: '', alternateKeys: ['slug'], counts: { installations_count: { of: 'installation', by: 'app_id' } }, refresh: { none: "an App is its owner's: the API reads one by its slug or with its own JWT, and lists none" } },
    // source: https://docs.github.com/en/rest/apps/installations "Lists installations of your GitHub App that the authenticated user has explicit permission"
    installation: { idPrefix: '', ...states['installation'], refresh: { none: "an installation is read back by its App: GET /user/installations lists an App's installations to a user access token of that App, and GET /app/installations to its JWT; the root's credential, a personal access token, is no App's" } },
  },
  // the GraphQL API: POSTed to /graphql; a query selecting a field the twin does not serve is GraphQL's own undefinedField
  // error (where the documentation stops: the error's words are GitHub's)
  // source: https://docs.github.com/en/graphql/guides/forming-calls-with-graphql "You can authenticate to the GraphQL API using a personal access token, GitHub App, or OAuth app."
  graphql: { paths: ['/graphql', '/api/graphql'], unmodeled: { message: "Field '{field}' doesn't exist on type '{type}'", type: 'undefinedField' } },
  // Webhooks: a repository's and an organization's hooks, and each GitHub App's installations, which take their App's URL,
  // secret and events; the body is the event's payload, with the installation it goes to for an App; signed with SHA-256
  // and SHA-1
  // source: https://docs.github.com/en/webhooks/webhook-events-and-payloads "The GitHub App installation. Webhook payloads contain the installation property when the event is configured for and sent to a GitHub App."
  // source: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries "GitHub uses an HMAC hex digest to compute the hash."
  // source: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries "The hash signature always starts with sha256= ."
  // source: https://docs.github.com/en/webhooks/webhook-events-and-payloads "X-Hub-Signature : This header is sent if the webhook is configured with a secret . This is the HMAC hex digest of the request body, and is generated using the SHA-1 hash function and the secret as the HMAC key ."
  // source: https://docs.github.com/en/webhooks/webhook-events-and-payloads "User-Agent : This header will always have the prefix GitHub-Hookshot/ ."
  // source: https://docs.github.com/en/webhooks/webhook-events-and-payloads "X-GitHub-Hook-Installation-Target-Type : The type of resource where the webhook was created."
  events: {
    scheme: [
      { kind: 'hmac', header: 'X-Hub-Signature-256', encoding: 'hex', prefix: 'sha256=', signed: '{body}' },
      { kind: 'hmac', header: 'X-Hub-Signature', encoding: 'hex', prefix: 'sha1=', signed: '{body}', algorithm: 'sha1' },
    ],
    headers: {
      'X-GitHub-Event': '$type', 'X-GitHub-Delivery': '$guid', 'X-GitHub-Hook-ID': '$endpoint._hook_id', 'User-Agent': 'GitHub-Hookshot/twin',
      'X-GitHub-Hook-Installation-Target-ID': '$endpoint._target_id', 'X-GitHub-Hook-Installation-Target-Type': '$endpoint._target_type',
    },
    types: {
      'issue.opened': 'issues', 'issue.closed': 'issues', 'issue.reopened': 'issues', 'issue.edited': 'issues', 'issue.labeled': 'issues', 'issue.unlabeled': 'issues',
      'issue.assigned': 'issues', 'issue.unassigned': 'issues', 'issue.milestoned': 'issues', 'issue.transferred': 'issues',
      'issue_comment.created': 'issue_comment', 'issue_comment.edited': 'issue_comment', 'label.created': 'label',
      'pull.opened': 'pull_request', 'pull.closed': 'pull_request', 'pull.reopened': 'pull_request', 'pull.edited': 'pull_request', 'pull.synchronize': 'pull_request',
      'pull.review_requested': 'pull_request', 'pull.ready_for_review': 'pull_request', 'pull.converted_to_draft': 'pull_request', 'review.submitted': 'pull_request_review',
      'push.record': 'push', 'release.published': 'release', 'release.created': 'release', 'release.edited': 'release',
      'check_run.created': 'check_run', 'check_run.completed': 'check_run', 'check_run.rerequested': 'check_run',
      'workflow_run.requested': 'workflow_run', 'workflow_run.in_progress': 'workflow_run', 'workflow_run.completed': 'workflow_run',
      'installation.created': 'installation', 'installation.deleted': 'installation',
      'discussion.created': 'discussion', 'discussion.answered': 'discussion', 'discussion_comment.created': 'discussion_comment',
      'repository.created': 'repository', 'repository.transferred': 'repository', 'repository.renamed': 'repository',
      'commit_status.created': 'status',
      'workflow_job.queued': 'workflow_job', 'workflow_job.in_progress': 'workflow_job', 'workflow_job.completed': 'workflow_job', 'repository.edited': 'repository',
      'installation.new_permissions_accepted': 'installation', 'member.added': 'member', 'membership.added': 'membership', 'organization.member_added': 'organization',
      'organization.member_invited': 'organization', 'team.created': 'team', 'team.edited': 'team', 'team.added_to_repository': 'team', 'milestone.created': 'milestone',
    },
    envelope: { '...': '$data', installation: '$endpoint._installation' },
    endpoints: [
      { storedAs: 'repo_hook', url: 'config.url', secret: '_secret', filter: 'events', enabled: 'active', match: [{ _repo: '$repo' }, { _org: '$owner' }] },
      {
        storedAs: 'installation', joins: { app: { storedAs: 'app', by: 'app_id' } }, url: 'app._hook_url', secret: 'app._webhook_secret', filter: 'app.events',
        match: [{ id: '$installation' }, { repository_selection: 'all', 'account.login': '$owner' }, { _repository_ids: '$repository_id' }],
      },
    ],
    record: '_hook_delivery',
    render: data,
    values,
  },
  // what GET /twin says this twin is
  discovery: {
    twinOf: "GitHub's REST and GraphQL APIs, git over HTTP, Apps and their installations, OAuth apps, and the web pages people sign in, authorize and install on",
    stores: 'people, organizations and teams, repositories and their git data, issues, pull requests and reviews, labels and milestones, commit statuses, releases, rulesets, environments with their secrets and branch policies, variables, deploy keys, security advisories, discussions, Apps and webhooks',
    identity: 'a person acts with a token the World issued: a personal access token from POST /_twin/users/{login}/tokens (the settings page), with the scopes chosen; the application holds the one POST /_twin/app-credentials issues',
  },
  // the World's doors (./semantics/doors.ts): what stands in for acts outside GitHub's API
  doors: [
    { id: 'users', method: 'POST', path: '/_twin/users', note: "a person signs up on github.com/signup: a username, an email address and a password" },
    { id: 'password', method: 'POST', path: '/_twin/users/{login}/password', note: "a person's github.com password, as they chose it" },
    { id: 'twoFactor', method: 'POST', path: '/_twin/users/{login}/two-factor', note: 'two-factor authentication turned on with an authenticator app: its setup key' },
    { id: 'totp', method: 'GET', path: '/_twin/users/{login}/totp', note: "the code a person's authenticator app shows now" },
    { id: 'tokens', method: 'POST', path: '/_twin/users/{login}/tokens', note: 'a personal access token, with the scopes chosen on the settings page' },
    { id: 'runStart', method: 'POST', path: '/_twin/repos/{owner}/{repo}/actions/runs/{run_id}/start', note: "a runner picks up a workflow run: its job's GITHUB_TOKEN, secrets and variables" },
    { id: 'runComplete', method: 'POST', path: '/_twin/repos/{owner}/{repo}/actions/runs/{run_id}/complete', note: 'a runner finishes a workflow run with its conclusion' },
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the token the World's application holds as GITHUB_TOKEN, as the runtime issues it at every boot" },
    { id: 'orgs', method: 'POST', path: '/_twin/orgs', note: "a new organization, made on github.com's new-organization page by the signed-in person" },
    { id: 'apps', method: 'POST', path: '/_twin/apps', note: "a GitHub App registered on its owner's settings page: its credentials and private key" },
    { id: 'oauthApps', method: 'POST', path: '/_twin/oauth_apps', note: "an OAuth app registered on its owner's settings page: its client id and secret" },
  ],
  // github.com's pages a person uses, git over HTTP, and the release assets' upload host (docs/contributing/architecture.md, "Screens")
  screens: [
    // the more particular paths first: a screen by its path answers the first that takes it
    {
      id: 'device', kind: 'flow', host: 'github.com', path: '/login/device', status: 'done',
      demand: 'gh auth login and every other device-flow client: the code it shows, entered by a person on github.com', controls: ['Device code', 'Continue', 'Authorize'],
      source: 'https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow',
    },
    {
      id: 'oauth', kind: 'flow', host: 'github.com', path: '/login/oauth', status: 'done',
      demand: "every application signing a person in with GitHub (an OAuth app, or a GitHub App acting for its user)", controls: ['Authorize', 'Cancel'],
      source: 'https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps',
    },
    {
      id: 'login', kind: 'flow', host: 'github.com', path: '/login', status: 'done',
      demand: 'every page of github.com sends a signed-out visitor here', controls: ['Username or email address', 'Password', 'Sign in'],
      source: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github',
    },
    {
      id: 'session', kind: 'flow', host: 'github.com', path: '/session', status: 'done',
      demand: 'the sign-in form posts here', source: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github',
    },
    {
      id: 'sessions', kind: 'flow', host: 'github.com', path: '/sessions', status: 'done',
      demand: 'a person with two-factor authentication enters its code', controls: ['Authentication code', 'Verify'],
      source: 'https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/accessing-github-using-two-factor-authentication',
    },
    {
      id: 'settings', kind: 'flow', host: 'github.com', path: '/settings', status: 'done',
      demand: "an app's manifest flow registers the app under the person", controls: ['Create GitHub App'],
      source: 'https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest',
    },
    {
      id: 'organizations', kind: 'flow', host: 'github.com', path: '/organizations', status: 'done',
      demand: "an app's manifest flow registers the app under an organization", controls: ['Create GitHub App'],
      source: 'https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest',
    },
    {
      id: 'apps', kind: 'flow', host: 'github.com', path: '/apps', status: 'done',
      demand: "an app's installation page", controls: ['Install', 'All repositories', 'Only select repositories'],
      source: 'https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app',
    },
    {
      // Ahead of git, whose path it shares: Code, Issues and Pull requests answer browsers; git transport
      // stays with ./screens/git.ts. Branch selection changes only the viewed ref, never the repository's default.
      id: 'repo', kind: 'workspace', host: 'github.com', path: '/{owner}/{repo}', status: 'done',
      demand: "a repository on the World's board shows its files and README; its Issues and Pull requests tabs open the agent's stored handoff and conversation",
      controls: ['Branches', 'Files', 'Raw', 'Issues', 'Pull requests', 'Open', 'Closed', 'Conversation', 'Files changed'],
      source: 'https://docs.github.com/en/get-started/using-github/communicating-on-github',
    },
    {
      id: 'git', kind: 'content', host: 'github.com', path: '/{owner}/{repo}', status: 'done',
      demand: 'code reaches GitHub by git push and leaves it by git clone',
      source: 'https://git-scm.com/docs/http-protocol',
    },
    {
      id: 'oidc', kind: 'content', host: 'token.actions.githubusercontent.com', path: '/', status: 'done',
      demand: "a workflow granted id-token: write asks for the token a cloud trusts, by the issuer's keys (the World's Actions runner; Sigstore's Fulcio reads the issuer's discovery and keys)",
      source: 'https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect',
    },
    {
      id: 'raw', kind: 'content', host: 'raw.githubusercontent.com', path: '/{owner}/{repo}', status: 'done',
      demand: "a file's bytes at a ref, where the contents API's download_url points",
      source: 'https://docs.github.com/en/rest/repos/contents#get-repository-content',
    },
  ],
  // a vendor-backed World's root: GitHub's webhooks, sent to the World's ingest door by the hook the operator adds, are
  // signed with the hook's secret. The event is the X-GitHub-Event header and its sub-action the body's `action`; each
  // event carries its object under a key of its own and the repository it happened in beside it, whose `full_name` is
  // the `{owner}/{repo}` a repository's children are kept under (each event's payload: issues `issue`, issue_comment
  // `comment`, pull_request `pull_request`, pull_request_review `review`, label `label`, milestone `milestone`, release
  // `release`, status the status at the top, repository `repository`, repository_ruleset `repository_ruleset`,
  // deploy_key `key`, repository_advisory `repository_advisory`, discussion `discussion`, discussion_comment `comment`,
  // workflow_run `workflow_run`, check_run `check_run`, installation `installation`). A `push` carries no object with an
  // id of its own (its commits and refs are git data), so it is acknowledged and folds nothing.
  // source: https://docs.github.com/en/webhooks/webhook-events-and-payloads "X-GitHub-Event : The name of the event that triggered the delivery."
  // source: https://docs.github.com/en/webhooks/webhook-events-and-payloads "The repository on GitHub where the event occurred."
  ingest: {
    scheme: { kind: 'hmac', header: 'X-Hub-Signature-256', encoding: 'hex', prefix: 'sha256=', signed: '{body}' },
    type: { header: 'X-GitHub-Event', action: 'action' },
    object: 'installation',
    types: {
      'installation.created': { resource: 'installation' }, 'installation.new_permissions_accepted': { resource: 'installation' }, 'installation.suspend': { resource: 'installation' },
      'installation.unsuspend': { resource: 'installation' }, 'installation.deleted': { resource: 'installation', deleted: true },
      'installation_repositories.added': { resource: 'installation' }, 'installation_repositories.removed': { resource: 'installation' },
      'issues.opened': { resource: 'issue', object: 'issue', parent: 'repository.full_name' }, 'issues.edited': { resource: 'issue', object: 'issue', parent: 'repository.full_name' },
      'issues.closed': { resource: 'issue', object: 'issue', parent: 'repository.full_name' }, 'issues.reopened': { resource: 'issue', object: 'issue', parent: 'repository.full_name' },
      'issues.labeled': { resource: 'issue', object: 'issue', parent: 'repository.full_name' }, 'issues.unlabeled': { resource: 'issue', object: 'issue', parent: 'repository.full_name' },
      'issues.assigned': { resource: 'issue', object: 'issue', parent: 'repository.full_name' }, 'issues.unassigned': { resource: 'issue', object: 'issue', parent: 'repository.full_name' },
      'issues.milestoned': { resource: 'issue', object: 'issue', parent: 'repository.full_name' }, 'issues.demilestoned': { resource: 'issue', object: 'issue', parent: 'repository.full_name' },
      'issues.deleted': { resource: 'issue', object: 'issue', parent: 'repository.full_name', deleted: true },
      'issue_comment.created': { resource: 'issue-comment', object: 'comment', parent: 'repository.full_name' }, 'issue_comment.edited': { resource: 'issue-comment', object: 'comment', parent: 'repository.full_name' },
      'issue_comment.deleted': { resource: 'issue-comment', object: 'comment', parent: 'repository.full_name', deleted: true },
      'pull_request.opened': { resource: 'pull-request', object: 'pull_request', parent: 'repository.full_name' }, 'pull_request.edited': { resource: 'pull-request', object: 'pull_request', parent: 'repository.full_name' },
      'pull_request.closed': { resource: 'pull-request', object: 'pull_request', parent: 'repository.full_name' }, 'pull_request.reopened': { resource: 'pull-request', object: 'pull_request', parent: 'repository.full_name' },
      'pull_request.synchronize': { resource: 'pull-request', object: 'pull_request', parent: 'repository.full_name' }, 'pull_request.ready_for_review': { resource: 'pull-request', object: 'pull_request', parent: 'repository.full_name' },
      'pull_request.converted_to_draft': { resource: 'pull-request', object: 'pull_request', parent: 'repository.full_name' }, 'pull_request.labeled': { resource: 'pull-request', object: 'pull_request', parent: 'repository.full_name' },
      'pull_request_review.submitted': { resource: 'pull-request-review', object: 'review', parent: 'repository.full_name' }, 'pull_request_review.edited': { resource: 'pull-request-review', object: 'review', parent: 'repository.full_name' },
      'pull_request_review.dismissed': { resource: 'pull-request-review', object: 'review', parent: 'repository.full_name' },
      'label.created': { resource: 'label', object: 'label', parent: 'repository.full_name' }, 'label.edited': { resource: 'label', object: 'label', parent: 'repository.full_name' },
      'label.deleted': { resource: 'label', object: 'label', parent: 'repository.full_name', deleted: true },
      'milestone.created': { resource: 'milestone', object: 'milestone', parent: 'repository.full_name' }, 'milestone.edited': { resource: 'milestone', object: 'milestone', parent: 'repository.full_name' },
      'milestone.closed': { resource: 'milestone', object: 'milestone', parent: 'repository.full_name' }, 'milestone.opened': { resource: 'milestone', object: 'milestone', parent: 'repository.full_name' },
      'milestone.deleted': { resource: 'milestone', object: 'milestone', parent: 'repository.full_name', deleted: true },
      'release.created': { resource: 'release', object: 'release', parent: 'repository.full_name' }, 'release.published': { resource: 'release', object: 'release', parent: 'repository.full_name' },
      'release.edited': { resource: 'release', object: 'release', parent: 'repository.full_name' }, 'release.deleted': { resource: 'release', object: 'release', parent: 'repository.full_name', deleted: true },
      status: { resource: 'status', object: '', parent: 'repository.full_name' },
      'repository.edited': { resource: 'repository', object: 'repository' }, 'repository.renamed': { resource: 'repository', object: 'repository' },
      'repository.archived': { resource: 'repository', object: 'repository' }, 'repository.deleted': { resource: 'repository', object: 'repository', deleted: true },
      'repository_ruleset.created': { resource: 'repository-ruleset', object: 'repository_ruleset', parent: 'repository.full_name' },
      'repository_ruleset.edited': { resource: 'repository-ruleset', object: 'repository_ruleset', parent: 'repository.full_name' },
      'repository_ruleset.deleted': { resource: 'repository-ruleset', object: 'repository_ruleset', parent: 'repository.full_name', deleted: true },
      'deploy_key.created': { resource: 'deploy-key', object: 'key', parent: 'repository.full_name' }, 'deploy_key.deleted': { resource: 'deploy-key', object: 'key', parent: 'repository.full_name', deleted: true },
      'repository_advisory.published': { resource: 'repository-advisory', object: 'repository_advisory', parent: 'repository.full_name' },
      'repository_advisory.reported': { resource: 'repository-advisory', object: 'repository_advisory', parent: 'repository.full_name' },
      'discussion.created': { resource: 'discussion', object: 'discussion', parent: 'repository.full_name' }, 'discussion.edited': { resource: 'discussion', object: 'discussion', parent: 'repository.full_name' },
      'discussion.answered': { resource: 'discussion', object: 'discussion', parent: 'repository.full_name' }, 'discussion.deleted': { resource: 'discussion', object: 'discussion', parent: 'repository.full_name', deleted: true },
      'discussion_comment.created': { resource: 'discussion-comment', object: 'comment' }, 'discussion_comment.edited': { resource: 'discussion-comment', object: 'comment' },
      'discussion_comment.deleted': { resource: 'discussion-comment', object: 'comment', deleted: true },
      'workflow_run.requested': { resource: 'workflow-run', object: 'workflow_run', parent: 'repository.full_name' }, 'workflow_run.in_progress': { resource: 'workflow-run', object: 'workflow_run', parent: 'repository.full_name' },
      'workflow_run.completed': { resource: 'workflow-run', object: 'workflow_run', parent: 'repository.full_name' },
      'check_run.created': { resource: 'check-run', object: 'check_run', parent: 'repository.full_name' }, 'check_run.completed': { resource: 'check-run', object: 'check_run', parent: 'repository.full_name' },
      'check_run.rerequested': { resource: 'check-run', object: 'check_run', parent: 'repository.full_name' },
    },
  },
  // the REST API's documented limits, primary and secondary, a write costing five points and a read one
  // source: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api "your personal rate limit of 5,000 requests per hour"
  // source: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api "No more than 900 points per minute are allowed for REST API endpoints"
  rateBudget: {
    // the vendor's documented allowance this budget stays inside (cited above)
    allowance: { perMinute: 900, source: 'https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api' },
    reason: "GitHub's REST API: 5,000 requests an hour for an authenticated user (primary), 900 points a minute (secondary; a GET 1 point, a POST, PATCH, PUT or DELETE 5), https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api; the hour's ceiling is the kernel's bound, below the documented 5,000",
    windowMs: 3_600_000, ceiling: 1_000, burstCeiling: 900, defaultWeight: 1, maxRetryAfterSeconds: 3600,
    rules: [{ match: '^(POST|PATCH|PUT|DELETE) ', weight: 5 }],
  },
  // the pack as the World registers it (world-core packRegistry)
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-github',
    resources: ['repository', 'issue', 'pull', 'workflow_run', 'check_run', 'release', 'app'],
    specSource: "GitHub's REST API description and GraphQL schema (spec/, provenance in spec/SOURCE.md)",
    description: 'GitHub twin — repositories and git over HTTP, issues and pull requests, releases, rulesets and environments, advisories, discussions, Apps, and the sign-in pages.',
    adoption: {
      sdks: ['@octokit/rest', '@actions/github', '@octokit/auth-app', '@octokit/auth-oauth-app', '@octokit/auth-oauth-device', '@octokit/core', '@octokit/graphql', '@octokit/webhooks', 'octokit'],
      scopes: ['@octokit/'],
      pypi: ['PyGithub', 'githubkit'],
      envStems: ['GITHUB', 'GH', 'BACKENDGITHUB', 'INFAPPCONNECTIONGITHUBAPP', 'INFAPPCONNECTIONGITHUBOAUTH', 'INFAPPCONNECTIONGITHUBRADARAPP', 'APPSMITHOAUTH2GITHUB'],
    },
    // the application's GITHUB_TOKEN, issued once the twin is up (./semantics/doors.ts appCredentials)
    credentialDoor: { path: '/_twin/app-credentials', body: {}, fill: { GITHUB_TOKEN: 'token', GH_TOKEN: 'token', GITHUB_PAT: 'token', GITHUB_ACCESS_TOKEN: 'token' } },
    hosts: [
      { host: 'api.github.com' }, { host: 'uploads.github.com' }, { host: 'raw.githubusercontent.com' }, { host: 'token.actions.githubusercontent.com' },
      // source: https://docs.github.com/en/repositories/creating-and-managing-repositories/cloning-a-repository "git clone https://github.com/YOUR-USERNAME/YOUR-REPOSITORY"
      { host: 'github.com', pathPattern: '^/login|^/session|^/settings/|^/organizations/|^/apps/|^/[^/]+/[^/]+/(?:info/refs|git-upload-pack|git-receive-pack)$|^/[^/]+/[^/]+\\.git/' },
    ],
  },
};
