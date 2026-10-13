# Linear customer life

Tidewater’s booking team uses Linear. Maya is the workspace administrator; Jonah is a
teammate. Fieldbook is their synthetic bug-filing integration, acting as its own OAuth app
user with read and write grants. Maya uses her personal API key for team setup and for the
release decision. Jonah asks Fieldbook’s reporter for a support summary; the reporter uses
the same workspace app grant. No runtime caller is attributed to an excluded application.

1. Maya creates Tidewater and invites Jonah. She registers Fieldbook’s OAuth application,
   logs in, reads its consent request and installs it. Fieldbook trades the returned code,
   learns its own actor and the workspace, and retains its refresh token.
2. Maya makes a personal API key and sets up the Booking App team and Spring release
   project through Linear’s API. Fieldbook loads the teams, projects and workflow states
   so it can offer the correct destination and state when someone files a finding.
3. Two testers report the same broken booking flow. Fieldbook files both reports, makes
   its missing filing label and applies it, and adds the first tester’s Safari details as
   a comment. A duplicate-search worker reads the open issues and verifies the second
   report’s label before archiving it. An hour later a separately queued archive job sees
   the already archived issue and is refused; the dashboard’s refresh shows the one open
   finding and its team counts distinguish the archived duplicate from the active issue. This second job is an independently delayed delivery, not an immediate retry.
   Maya then opens Linear's workspace in her existing browser session, follows the actual
   Booking App team list, filters by Checkout and opens the remaining issue from its row.
   Its title, description and Safari comment give her the triage context. She selects
   In Progress and Jonah from that issue's actual property options and saves. The redirected
   detail and her personal-key GraphQL read both show the same stored state and assignee.
   Jonah signs in with the synthetic password established when he joined, opens his Assigned
   view and finds the issue; his Created view is empty because Fieldbook created the reports.
4. Eight hours later Maya ships the fix and closes the first issue. Three hours later a
   tester reproduces it after the release. A new filing worker resolves the existing label
   rather than keeping the setup worker’s cached id. Fieldbook reads the closed state, chooses the
   team’s unstarted state and reopens it as urgent, assigns Maya and removes the finished release
   project. The team’s issue view and detail/comments view
   give Jonah the support context. His reporter loads workspace members, release projects
   and comments for the summary rather than relying on Maya’s setup session.
5. The worker is offline for 25 hours. Its cached access token is expired when it resumes.
   It exchanges its refresh token and resumes the report with the newly returned token.

The served acts are the workspace/person/application/key doors, consent screen and workspace
team-list/detail/property forms; OAuth
code and refresh exchanges; viewer, organization, teams, team, workflowStates, users,
projects, comments, issues, issue and issueLabels reads; teamCreate, projectCreate,
issueCreate, issueLabelCreate, commentCreate, issueUpdate and issueArchive mutations.
The independent published-example journey establishes its own preconditions and also
exercises Linear’s documented refresh-token retry grace, enabled and disabled client-credentials
grants, and the published relation, logical, date and estimate filters. Revocation,
private-team membership management and GraphQL fields outside the declared scope remain the gap.

The workspace handoff uses the existing consent-session capture, actual team/issue links,
the form action/key and In Progress/Jonah option values read from the detail. The browser
form and GraphQL share `issueUpdate`; the life adds no screen operation IDs or second store.
These workspace acts and control decisions were authored by `/root/journey_evidence_finish`
on 2026-10-09, extending Contributor 74's original integration life. They remain declarations,
with no walk run or passing result claimed. Their public layout and action sources are
[screen-references.json](../spec/screen-references.json). Subscribed/Activity views, advanced
curation and broader assignment permissions are outside this browser scope.

The installed customer entry uses the demand-pinned official SDK 86.0.0 with its default User, Team and Issue selections. Normal CLI initialization supplies a synthetic owner personal key through the settings doors. The SDK identifies that owner, creates a public team and issue, updates and reads the issue, observes its creator/team counts, then reads those same records after stop/resume. The independent SDK case also archives an issue and observes default versus includeArchived team counts. Nullable optional feature state is unconfigured; starter settings whose production defaults are unpublished are labeled synthetic. The entry does not narrow the SDK selections.
