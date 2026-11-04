# Tidewater's on-call queue

Maya administers Tidewater's Jira Cloud site, tidewater.atlassian.net; Jonah is a developer
with site access. Maya makes an account API token for her on-call agent: it acts as Maya
using her email and that token, including her project administration permission. The
tracking integration is a separate OAuth 2.0 app: Maya grants read:jira-work,
write:jira-work, read:jira-user and offline_access on Tidewater only. Its refresh token
rotates before each day's work; its access tokens last an hour. The setup helper's
separate admin grant is used only during its initial sitting.

1. Maya creates the site, gives Jonah access, and registers the integration's callback.
   She creates her account API token, reads her current account through `/rest/api/3/myself`
   (`jira.myself.getCurrentUser()` in the cookbook's jira.js client), and uses the returned
   `accountId` as the project's `leadAccountId`. Then she sets up BOOK and its Checkout and Schedule
   components through Jira REST, Checkout led by Jonah, who owns the booking checkout. The setup helper connects with its admin grant.
2. Maya connects the tracking integration through Atlassian's authorize page, logs in,
   chooses Tidewater and accepts its scopes. The integration trades the returned code,
   discovers the accessible site's cloudid, and loads projects, issue types and filing
   taxonomy to populate its picker.
3. Twelve hours later two testers report different checkout failures, on Safari and
   Firefox. The integration refreshes its expired access token before filing. A stale raw-HTTP
   script's plain-JSON description is refused by REST v3; the corrected ADF request
   files the Safari finding. A separate Firefox report is filed. The triager searches open
   reports and comments on the Safari issue with a second tester's reproduction.
4. Maya starts the Safari fix. A day later she ships it, verifies checkout and closes
   the issue with her own account token. Jonah shipped a fix of his own in that release, the
   Schedule page's time-zone label; with his own API token his script reads which BOOK
   transition leads into Done and files the fix under Schedule already done, so the release's
   done list shows it. Another day later a deployment regresses Safari.
   The integration rotates its token, reads the issue's status and available transitions,
   and reopens it instead of filing a duplicate.
5. The triager's queue pages through open issues. Jonah lists BOOK's open reports from his
   laptop (a GET search with his token) and reviews the Firefox report; it loses every Firefox
   booking, so the triager labels it for follow-up, raises it to Highest and assigns it to
   Jonah, whom its assignee picker offers for that issue, and Maya reads the Safari discussion to understand the
   regression. The filing picker loads current labels for the next report.

The steps reach getCurrentUser, createProject, createComponent, searchProjects, getProject,
getProjectComponents, getAllLabels, findAssignableUsers, createIssue, getIssue,
editIssue, searchAndReconsileIssuesUsingJqlPost, searchAndReconsileIssuesUsingJql (Jonah's GET
search), addComment, getComments, getTransitions and doTransition, and the account/site/app
doors and authorize screen. No current product uses
Runhuman 1: journeys/demand.json records the current scan and pinned cookbook caller.
