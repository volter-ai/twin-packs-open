# Tessellate on GitHub: the outline

Author: Contributor 101

**Inspecting the agent's handoff.** After the agent opens an issue or a pull request through the vendor's API,
octocat follows the repository's Issues or Pull requests tab to its list, opens the numbered conversation, and
reads the stored description and comments, state, labels, assignees and milestone. A pull request also names its
head and base branches, and its Files changed tab reads the stored Git comparison and patch. Open and closed
lists are separate views of those same records. These are read-only
workspace pages; creating, commenting, editing and merging still use the existing API. The page hierarchy and
conversation layout follow GitHub's public [communication guide](https://docs.github.com/en/get-started/using-github/communicating-on-github)
and its published issue and pull-request images, without signing in to GitHub or capturing its application.

**Customer.** Tessellate, an open-source geometry library. Its author, octocat, keeps it in her organization,
`tessellate-dev`, from the start of 2026, and over the year hands its day-to-day running to an Open Autonomy agent,
works on it in the Volter Editor, ships releases that installers and update checks read, and signs in with her GitHub
account, as her users do, to the services around it. The World clock starts 2026-01-01; the life spans about ten
months, into July.

**People and programs, each with the credential it acts with.**
- **octocat** (the author, the organization's owner): her personal access token for scripts, and the `gh` command line
  on her laptop, signed in once through GitHub's device flow (an OAuth token of GitHub CLI's OAuth app with `repo`,
  `workflow`, `admin:public_key` and `read:org`, as Open Autonomy's setup asks), which is how setup, the Volter Editor's
  pull requests and her other terminal work reach GitHub.
- **Ada** (a contributor the Team editor adds to the project's roster): her github.com account.
- **Grace** (a user of the library, who signs in to the services around it with GitHub): her github.com account.
- **Open Autonomy's agent**: the project's GitHub App, registered from a manifest and installed on `tessellate`; its
  valve signs the App's JWT, finds the installation and mints installation tokens scoped to the one repository, with
  which the agent's community desk, reviews and releases act, and its git goes over HTTPS.
- **Open Autonomy's platform** (open-autonomy.org): an OAuth app people sign in to with GitHub's web flow (the Team
  editor asking for `public_repo`); and its reader token, octocat's token for the platform, which syncs the project's
  page.
- **Substrate**: a GitHub App with expiring user tokens and the device flow turned on; a person signs in with it, by
  the device flow or the web flow, and its token is refreshed.
- **The Volter Harness board**: GH_TOKEN, octocat's token; its webhook receiver, which a repository webhook reaches.
- **Her CI service**: her token, reporting a commit status.
- **The installers and update checks**: the Volter Harness Windows installer with a token, the Volter Editor's
  workbench download with a token, Rallly's update check with none.
- **Workbench's store**: no credential; it reads a repository's page and clones it.
- **The sign-in pages around the library**: Dub, Postiz, LibreChat and the Twin platform each an OAuth app signing
  Grace in (`user:email`, `read:user`), reading who she is and her addresses; Twenty's marketplace claim asking
  `read:org` to check she owns the publishing organization.
- **LibreChat's skill sync**: octocat's token, reading the skills a repository holds by its commit, trees and blobs.
- **Twin's World action** in the library's CI: the job's token, keeping one comment on a pull request.
- **Twin's on-call recipe**: octocat's token, through GitHub's own SDK (Octokit), triaging each new issue and answering
  on it with the ticket it filed in her tracker.
- **The World's Actions runner** (twin-world's runtime, GitHub's hosted runner as a World service): the token it is
  given to find repositories and their queued runs, the runner door to start and complete a run, and the job's token
  and OIDC request the door hands it; **Sigstore's Fulcio** reads Actions' OIDC issuer to verify a job's token.

Code reaches GitHub through git pushes; pull requests, reviews and merges go through the REST API as the programs
above send them and through the GraphQL API as `gh` sends them; Discussions, which have no REST API, go through the
GraphQL API.

1. **January: the account and the organization.** octocat's github.com password, two-factor authentication and
   personal access token. She signs the `gh` command line in on her laptop through the device flow (gh polls before
   she has entered the code and is told to wait; she signs in to github.com with her password and two-factor code,
   enters the code and authorizes it; gh's next poll gets the token) and checks who it is signed in as. She makes the
   `tessellate-dev` organization on github.com (a web page, not the API).
2. **January: Open Autonomy's setup.** Setup asks gh who she is and whether `tessellate-dev` is an organization (it
   is). It finds no `tessellate-dev/tessellate` and creates it as gh does (the owner's account read for its node id,
   then the GraphQL createRepository mutation), pushes her checkout over HTTPS, its Open Autonomy configuration among
   it, and reads the repository back. It turns on auto-merge. It finds no deploy key and adds the agent's, with write
   access. It finds no rulesets and adds `main-protected` (no deletion, no force push, a pull request with one
   approval). She leaves the production door for later. A week later her deploy script tags what it deployed with an
   annotated tag, and she reruns setup with the production door: it asks for the `owners` team and is told there is
   none, creates it, makes octocat its maintainer and gives it push on the repository; it finds no `prod` branch,
   lists the deploy tags, reads the newest tag object for its commit and makes `prod` there; it adds `prod-protected`,
   creates the `production` environment admitting custom branches, finds its branch policies empty and adds `prod`,
   and, the tag rules not being there, adds `deploy-tags-admin-only`. It sets the Cloudflare account id as a
   repository variable, finds the environment holds no secret, and seals the Cloudflare token to the environment's key.
   Octocat lets `release/*` deploy too, by hand; the next week's rerun finds the team and `prod`, removes `release/*`,
   writes the tag rules again, and, the variable it sets being refused as existing, updates it.
3. **January: the agent's App.** Setup's agent registers the project's App from a manifest on the organization's
   settings page; GitHub sends it back to the credentials receiver with a code, which the receiver exchanges for the
   App's id, key and slug, once (a second exchange of the code is not found). The valve, asked for a token before
   anyone has installed the App, is told the repository has no installation. octocat installs the App on `tessellate`
   from its installation page; the valve finds the installation and mints a token for the one repository. The agent's
   ship finds no Release and, main being where prod is, is refused for having nothing to merge.
4. **February: the community desk.** octocat turns on Discussions. Grace files a bug and asks a question in a
   discussion. The agent's first poll reads every issue with its comments and every discussion with its replies; it
   comments on Grace's bug, answers her discussion, and opens a task issue for the fix assigned to octocat. Grace
   replies on her bug; the next poll, since the last one, reads what changed. The agent marks the task blocked (its
   body rewritten), posts a reminder, checks the newest-changed issue and discussion, and starts a discussion in the
   Announcements category for the month's memo. That afternoon octocat starts Twin's on-call recipe on the
   library; its first run reads the open bug by its number and answers on it with the ticket it filed.
5. **February: the agent's pull request.** octocat adds a webhook for the Volter Harness board. The agent pushes its
   fix to a branch through the valve and opens a pull request that fixes Grace's bug; the hook's deliveries show the
   board was sent it, and the board reads the pull request, the open ones and when its head was committed. Twin's
   World action keeps one comment on the pull request with its preview link: it finds none of its own and posts it, and
   on the next push edits it. The agent, its author, cannot approve it; octocat asks for a test, the agent pushes one,
   and she approves the new head. Pushing the fix to main directly is refused by the ruleset. gh merges the pull
   request (the schema's fields introspected, the pull request found by its branch, mergePullRequest), which closes
   Grace's bug, and the agent closes its task.
6. **March: the Editor's pull request.** octocat writes the guide in the Volter Editor: it fetches, publishes her
   branch and opens the pull request as `gh pr create` does (the repository's info, no open pull request for the
   branch, then createPullRequest). Her CI service reports a status on its head. gh pr view shows it open, its check
   passing and a review required; merged before a review, it is refused; the agent approves it at the head it read, and
   gh merges it.
7. **March: the Team editor and the project's page.** Open Autonomy's platform, run by its own organization, is an
   OAuth app with a reader token of its own. octocat adds Ada to the team in the Team editor, which asks her GitHub for
   `public_repo`: it reads who she is, the repository, its default branch's head and the roster there, checks Ada's
   account, branches from the head, commits the new roster with the file's sha, is refused when it sends the edit again
   with the sha it read before, and opens a draft pull request. The platform reads with its own token whether she
   administers its grants pool (she is no member of its organization; its operator is), and an account by its id.
   octocat plans 1.0 as a milestone. The platform's sync reads the repository, its head commit, the compare from the
   abbreviated commit the site runs, a first parent, every milestone, whether the account is an organization, the
   roster by the raw host and by the contents API, and the README.
8. **April: the Release.** With the fix and the guide on main, the agent's ship finds no open Release, finds prod, opens
   the Release from main to prod, writes its review into the body, reads its comments, tells the owner once, and finds no
   Release merged since.
9. **May: 1.0 and the readers of releases.** octocat publishes `v1.0.0` with the built tarball and the Windows zip as
   assets, and publishes a security advisory for a fixed parsing flaw. Rallly-style update checks list the releases
   page by page and the published advisories. The Volter Harness installer finds the latest release and a release by
   its tag and downloads its asset's bytes. The Editor's workbench, released in a private repository, is not found
   without a token and is downloaded with one. Twenty's site reads the library's stars; Workbench's store reads the
   repository and its README rendered, and clones it; a file is read from the raw host. LibreChat syncs the skills the
   repository holds: the branch's commit, its tree, the skills tree recursively, and a skill's blob.
10. **June: signing in with GitHub.** Grace signs in to Dub, Postiz, LibreChat and the Twin platform with GitHub: each
    sends her to GitHub's authorization page for the scopes it asks, she authorizes it, and its server exchanges the
    code for her token and reads who she is and her email addresses. Twenty's marketplace claim asks for `read:org`
    and reads whether she administers `tessellate-dev`: she is not a member and is told so; octocat's claim finds her
    an admin. Substrate signs Grace in by the device flow, and later by the web flow with no scope; its expiring token is
    refreshed (expired, it is refused) with the refresh token and no secret, as a device flow's token is, and saves the rotated pair; her browser's git clones the library with the token.

11. **July: the World's Actions runner and a catalog release.** octocat creates a private catalog repository in the
    organization, gives it a variable and a secret sealed to the repository's key, and pushes it with a workflow that
    publishes from main and pull requests. The World's runner finds the repositories it serves (the user's own, the
    user's organizations and theirs), finds the queued run, starts it through the runner door (the job's token, the
    secret, the OIDC request), reads the organization's and the repository's variables, the workflow file at the run's
    commit and the repository, and checks the commit out with the job's token. The publish step asks Actions' OIDC
    provider for a token, and Fulcio reads the issuer's discovery document and keys. The runner completes the run, after
    which the runner stops using the job's token. A package is submitted as a pull request, whose run is queued; octocat merges it
    with REST's merge, and the merge's push queues the workflow on main.

12. **A vendor-backed World reads octocat's account back.** With her token, a World rooted at her account refreshes
    what it reads back: her teams (owners, in tessellate-dev), the library's labels, its issues' and pull requests'
    comments (the App's question to Grace first), v1.0.0's assets (a release the library does not have: 404), its
    webhooks (the board's, the secret masked), its environments (production), and the catalog's workflows (Publish) and artifacts (none uploaded). Installations are not read back:
    GitHub lists them to an App's own credentials, not a personal access token.

Each refusal in the life has one shown cause, and each state that returns does so after time has passed and for a
reason the story shows.

**What the story reaches outside the REST API, and why.** Setup's, the agent's, the Editor's, Substrate's and the
store's git is git over smart HTTP; `gh auth login` and Substrate's sign-in are GitHub's device flow; the sign-ins are
the OAuth web flow; the App is registered from its manifest on github.com and installed on its installation page; a
file is read from raw.githubusercontent.com; a job's token is Actions' OIDC provider's at
token.actions.githubusercontent.com, and the runner's door is the World's (GitHub's hosted runner is compute outside the API). The Volter Harness `install.sh` downloads a release asset from
`github.com/<repo>/releases/latest/download/<asset>`, a browser download the twin does not serve.

The shipped Twin deploy scan also lists successful runs of publish.yml before its first release finishes: an empty list. The workflow filename and numeric id list the same queued run; an absent workflow is refused.
Octocat also creates a personal Workbench demo with the REST SDK (repos/create-for-authenticated-user), reads its initial README, and encounters the duplicate-name and missing-credential refusals.

The workflow list reaches its stored check-suite id and a different id; created reaches exact dates/timestamps, closed and open ranges, strict and inclusive comparisons, and invalid syntax. The catalog PR run keeps its pull-request association by default and with exclude_pull_requests=false; true clears only the response array, retaining the run and its total count.
