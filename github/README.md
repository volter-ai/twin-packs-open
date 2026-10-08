# @volter/twin-github

A local GitHub: the REST API the unmodified `@octokit/rest` and `gh` call (`https://api.github.com`), the GraphQL API
beside it, git over smart HTTP, and the github.com pages an application sends a person through, over one state.

## Use with an existing app

In an app that already uses this vendor, install this exact release and the product CLI:

```console
npm install --save-dev --save-exact @volter/world@3.0.127 @volter/twin-github@3.0.7
./node_modules/.bin/volter world init --name my-app --twins github --source github=@volter/twin-github
```

Run the local executable from this app’s folder; if it is missing, complete the installation here before continuing.

Review the detected vendor and generated bindings before booting. Read the credential names and limitations below; the World supplies throwaway credentials. Then run your app's own command through the World:

```console
./node_modules/.bin/volter world up
./node_modules/.bin/volter world run -- npm test
./node_modules/.bin/volter world log
./node_modules/.bin/volter world down
```

Here `npm test` is your app's existing command; replace it with your app or test command. `down` retains state.
A later `up` resumes it; do not reset or initialize again merely to return.

Publisher and catalog contribution instructions: [the public publisher guide](https://github.com/volter-ai/twin-catalog-open/blob/main/docs/contributing.md).


A Protocol 3 derived pack ([publisher guide](https://github.com/volter-ai/twin-catalog-open/blob/main/docs/contributing.md)): the REST surface is generated from GitHub's published OpenAPI description and the GraphQL schema beside it
(`spec/`), plain reads and updates are the derived core's, the state machines are `src/semantics/states.ts`,
handlers by operationId (`src/semantics/<family>.ts`) serve only what an operation does beyond them, the GraphQL
resolvers are `src/semantics/graphql.ts`, and GitHub's own computation (workflow files, advisories, a README's
Markdown, TOTP, a CVSS vector's score) is `src/engine/`. It serves what the applications call and what one customer's
life sends ([journeys/demand.json](./journeys/demand.json), [journeys/decisions.json](./journeys/decisions.json),
[journeys/customer-life.json](./journeys/customer-life.json)); every other operation answers GitHub's own 404, and every
other GraphQL root field GraphQL's undefinedField. GitHub's published examples for the operations served, and the rules
its pages state, are replayed in [journeys/vendor-examples.json](./journeys/vendor-examples.json)
([spec/doc-examples.json](./spec/doc-examples.json)).

```bash
world-github serve [--port N] [--root DIR] [--read-only]
```

Point a client at it (`new Octokit({ baseUrl })`, `GH_HOST`), or run the application in a World, whose routing sends
`api.github.com`, `github.com` (its sign-in, settings and app pages and git), `uploads.github.com`,
`raw.githubusercontent.com` and `token.actions.githubusercontent.com` here.

## What it models

- **Who it is for**: Volter's own products (Open Autonomy's kit, setup and platform, the Volter Harness board and
  installer, the Volter Editor, Workbench's store, Twin's World action, Actions runner, catalog release and on-call
  recipe, Volter identity's sign-in), Dub's GitHub sign-in, Rallly's update check and Twenty's site; the opt-in GitHub
  features of LibreChat, Postiz and Twenty are listed apart (`demand.json`'s `optional`).
- **Repositories**: made by GraphQL `createRepository` (as `gh repo create` makes them), read with the caller's
  `permissions`, their README (and its HTML), contents committed through the API; rulesets, enforced on pushes,
  contents commits and merges; environments with their branch policies and secrets, repository variables and secrets
  (sealed to the repository's key), deploy keys; teams and their repositories.
- **Git**: smart HTTP clone, fetch and push at `github.com/<owner>/<repo>.git`, contents, commits, compares, trees,
  blobs, refs and annotated tags read from the same objects, abbreviated SHAs resolved; a push a ruleset refuses is
  refused as GitHub refuses it (GH013).
- **Issues and pull requests**: issues (read one by its number, as Octokit's `issues.get`), labels, milestones and
  comments; pull requests from branches of the repository, their reviews, and merges (GraphQL `mergePullRequest`, and
  REST's merge, squash or rebase) that close the issues their bodies name; a pull request closes with its deleted head
  branch.
- **Releases, statuses, webhooks and advisories**: releases with uploaded assets, commit statuses, a repository's
  webhooks and their deliveries, repository security advisories (made and published).
- **Actions, as the World's runner works it**: a push starts the workflows of its commit; the runner (twin-world's
  `volter-world-actions-runner`) finds its repositories and their queued runs, starts one through the World's door
  with its job token, the repository's secrets (sealed to its key) and variables and an OIDC request, and completes it
  with its jobs' conclusions and artifacts; the OIDC provider (`token.actions.githubusercontent.com`) signs the job's
  token, which Sigstore's Fulcio twin verifies.
- **Apps**: GitHub Apps from a manifest or the World's door, installed from their installation page, their JWT, a
  repository's installation and its installation tokens (narrowed to permissions and repositories).
- **Sign-in**: github.com's password and two-factor pages, OAuth apps' web flow, GitHub Apps' user tokens and
  refresh tokens (a refresh needs no secret and revokes the access token it replaces), and the device flow
  `gh auth login` runs.
- **GraphQL**: `repository` with what Open Autonomy's community desk and `gh pr create`, `gh pr view` and `gh pr merge`
  read (its owner, default branch, the caller's permission, its parent, its discussions and their categories, its pull
  requests by branch with their commits' status rollup, review decision and merge state), the schema's own
  introspection, and the mutations they send: `createRepository`, `createDiscussion`, `addDiscussionComment`,
  `createPullRequest` and `mergePullRequest`.

## Repository browser

The Code tab shows the stored repository files and README with GitHub’s familiar file-list and About layout. Select a branch, open folders and files, or follow Raw to the stored blob content. Branch selection changes only the viewed ref; mounted World URLs stay local. A Markdown file renders through the shared Markdown renderer; text files show line anchors.

Issues, pull requests, Actions, Projects, Security, Insights and Settings remain API capabilities rather than browser tabs. Those tabs and the clone dropdown and Blame controls are unavailable in this mirror. Symbol navigation and submodule navigation are outside this browser scope.

## Events

A write GitHub reports sends its webhook (`issues`, `pull_request`, `push`, `installation`, …), declared as data the
kernel renders, signs (`X-Hub-Signature-256`, and the SHA-1 `X-Hub-Signature`) and delivers: to the repository's and
its organization's hooks whose events take it, and to each GitHub App whose installation covers the repository, with
the installation in the payload. A hook's deliveries are `GET /repos/{owner}/{repo}/hooks/{hook_id}/deliveries`.

**Vendor-backed.** Each stored resource reads back by its list (under its repository, `{owner}/{repo}`) but installations,
which only an App's own credentials list, GitHub's
webhooks are ingested by `X-Hub-Signature-256` (each event's object at its own key, its repository by
`repository.full_name`; a push is acknowledged and folds nothing), and calls are charged against GitHub's documented
limits (5,000 an hour, 900 points a minute).

## Doors

What happens outside the API is the World's door (`/_twin/…`, declared in the manifest): signing up, choosing a
password, turning on two-factor authentication and reading the authenticator's code, making a personal access token,
an organization, a GitHub App or an OAuth app, and a runner starting and completing a workflow run.

## What it leaves out

Every operation no in-scope application and no life step reaches: the manifest's `unmodeled` (the rest of Actions,
Pages, deployments, attestations, Dependabot and code scanning, Projects, search, forks, transfers, branch
protection, issue locks), the GraphQL root fields beyond `repository` and the five mutations, and the browser
download of a release's `latest` asset, which `install.sh` fetches. Where GitHub documents more than the twin does, the
twin does less: a rebase merge is one commit, a CVSS 4.0 vector is not scored, and a pull request's head is a branch of
its own repository. Its standing is twin-packs-p3's generated `STANDING.md`.
