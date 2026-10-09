# @volter/twin-slack

Slack's Web API, workspace invitations and member pages, app configuration and OAuth install pages, incoming
webhooks and signed app deliveries. The pinned API and corrections are in spec/; provenance is spec/SOURCE.md.
The current product callers, operation decisions and customer story are in journeys/.

## Use with an existing app

Use Node 22.6 or newer.

In an app that already uses Slack, install the product CLI and this exact twin release:

```console
npm install --save-dev --save-exact @volter/world@3.0.147 @volter/world-core@3.0.147 @volter/twin-slack@3.0.9
./node_modules/.bin/volter world init --name my-app --twins slack --source slack=@volter/twin-slack
```

Run the local executable from this app’s folder; if it is missing, complete the installation here before continuing.

Review the detected vendor and bindings before booting. The World issues throwaway bot, Socket Mode and signing
credentials using the names listed below. Run the app's own command inside the World:

```console
./node_modules/.bin/volter world up
./node_modules/.bin/volter world run -- npm test
./node_modules/.bin/volter world log
./node_modules/.bin/volter world down
```

Replace `npm test` with your app or test command. `down` retains state and a later `up` resumes it.
Publisher and catalog contribution instructions: [the public publisher guide](https://github.com/volter-ai/twin-catalog-open/blob/main/docs/contributing.md).

The pack models an ordinary workspace with people, channels, timestamped messages and threads, files, normal workspace
user groups, apps and their scoped grants. Its APIs keep Slack's ok/error envelope, cursor paging and caller visibility.
OAuth codes and grants have their own secrets, expiry and revocation. File bytes use the kernel blob seam. Scheduled
messages use the World clock.
Conversation workspace identity uses Slack's `context_team_id`, including channel visibility after vendor refresh
and shared-World cloning. Existing local rows that carry `team_id` remain readable.

A person creates the workspace at slack.com/get-started and joins through invitation mail and the Join page. Workspace
admins manage members and invitation requests at slack.com/admin. Developers configure their app at api.slack.com/apps;
installation uses slack.com/oauth/v2/authorize and oauth.v2.access. Program calls use their own issued tokens; a person's
synthetic client session is xoxp-<user-id>. Real credentials are never needed.
In a named World browser, an existing member enters OAuth consent through `slack.com/signin`: their email,
the confirmation code in the twin's `/_twin/mail` inbox, then the browser session. The consent page shows the
requested bot/user scopes and the eligible channel for an incoming webhook. Apple/Google, SSO, passkeys and
multi-workspace switching are outside that screen's scope. This flow sends no real email.
Fresh local Worlds seed a synthetic workspace named World with its owner and #general through that signup flow.
The default seed is copied into the application's `.volter/seeds/` by init and remains editable there. Use the CLI and core versions pinned above for this release.

The conversation mirror opens at `app.slack.com/client/<workspace-id>/<conversation-id>`, or `/client`
at the World's Slack address. Sign in with an existing synthetic member's email and the confirmation code in
`/_twin/mail?to=<email>`; the opaque browser session acts as that active member. The sidebar lists joined
channels and existing individual or group DMs. Public channels outside the member's sidebar are available
under Browse channels, with Join Channel using `conversations.join`. New message opens or resumes a DM
through `conversations.open`.

The client displays actual stored messages in time order, sender names, text, Slack links and mentions,
text content from blocks and attachments, file names, edit markers and thread reply counts. Reply in thread
opens the original message and its replies alongside the channel. Send now and thread replies call
`chat.postMessage`, including `thread_ts` and the optional `reply_broadcast`. The existing API supplies
timestamps, stored writes and app events. A successful call opens a fresh stored view; a refusal preserves
the draft and displays the API's error. Archived channels retain readable history and have no composer.
Missing or inaccessible conversations and missing threads refuse without disclosing their messages.
The administration, app settings and OAuth screens remain separate.

The client is a basic conversation mirror. Message editing, reactions, file upload/download, rich composer
formatting, search, notification/activity feeds, huddles, canvases and lists have no client controls here.
Reading existing conversations works without JavaScript; automatic return to the conversation and inline
API errors require it. A native form submission receives the API's JSON answer.
Thread selection uses the mirror's `thread_ts` query parameter. Message times are displayed in UTC.
The local sign-in page also answers on the client host so its World-scoped session remains on the
same browser origin. Appearance follows Slack Support's public quick-start channel, sidebar and composer
references; no Slack page, avatar asset or DOM is captured or copied into the pack.

World doors represent acts the API does not perform: an externally developed distributed app (/_twin/apps), a client
slash command, Home opening, link share or action (/_twin/client/*), and observation of app deliveries or invitation mail
(/_twin/deliveries and /_twin/mail). The application's own credentials come from /_twin/app-credentials, which the
World asks at every boot: its own app, installed in its workspace, with a bot token (`SLACK_BOT_TOKEN`), an app-level
Socket Mode token (`SLACK_APP_TOKEN`) and the app's signing secret. It is subscribed to every event the twin sends (link_shared
aside: it names no unfurl domain) and receives them over Socket Mode (it has no Request URL); its bot holds every scope Slack's methods name. Stored vendor mutations still use the API or vendor pages.

Its callers are journeys/demand.json's: RH2's Slack app and channel bridge, Volter Harness's Slack platform (the Chat
SDK in Socket Mode), Twin's on-call recipe, Dub's Slack integration and Postiz's Slack channel. Enterprise Grid
administration, SCIM provisioning and legacy OAuth are outside the modeled slate. Every Web API operation no demand,
life step or refresh reaches answers the gap (unknown_method), files.upload among them. The upload flow is
files.getUploadURLExternal, its returned byte-upload URL and files.completeUploadExternal.

Publishing and catalog process: [the public publisher guide](https://github.com/volter-ai/twin-catalog-open/blob/main/docs/contributing.md). Standing is the Protocol 3 grade and score-pack report, recorded after the whole
slate is written. No result here asserts that the final walk or independent review has run.

Dub priority support can create a channel and send a recipient-specific Slack Connect email invitation. The stored
pending invitation is read through conversations.listConnectInvites with count/cursor pagination and retained in the
local mail outbox. Receiving-workspace acceptance, approval, user-id recipients and join links are outside this
workflow; the twin sends no real invitation mail. Targeted invitation responses disclose no shareable URL.
