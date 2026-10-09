// Slack's manifest: the vendor facts its published Web API spec does not carry (docs/contributing/architecture.md,
// "Protocol 3"). The surface is generated (./generated/surface.gen.json, from ../spec by scripts/derive-pack.ts): the
// Web API's methods, each `POST /api/<method>` (a GET reaches the same method), grouped by their first dotted part.
//
// THE WIRE. Every answer is HTTP 200 with `ok`: `{ok: true, …}` or `{ok: false, error: "<code>"}`
// (https://docs.slack.dev/apis/web-api/#responses). A method's arguments come as a form, as JSON, or in the query; its
// token as `Authorization: Bearer` or the `token` argument (https://docs.slack.dev/authentication/tokens). A method the
// twin does not serve answers Slack's `unknown_method`.
//
// THE WORLD'S SLACK. An ordinary workspace, `T0VOLTER01`, made on the sign-up page (./screens/get-started.tsx).
// No Enterprise Grid or SCIM provisioning is modeled. A person acts with their own client token,
// `xoxp-<their user id>` (the twin's decision: the Slack client's session, which no API mints); an app acts with the
// tokens its install makes (oauth.v2.access), each kept by its SHA-256 with the scopes granted (`_token`). A browser's
// member identity comes from email confirmation and the kernel session kit, with no injected client header.
import type { DerivedManifest } from '@volter/world-core';
import { data, SLACK_EVENTS, values } from './semantics/shared.ts';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'slack',
  service: 'slack',
  // "The Web API accepts arguments as application/x-www-form-urlencoded or application/json" (docs.slack.dev/apis/web-api)
  // every method is `/api/<method>` (https://docs.slack.dev/apis/web-api/#basics): the spec's server URL, so the surface's
  // basePath
  body: { form: { coerce: false } },
  ids: { template: '{prefix}{n}' },
  time: 'unix',
  error: { ok: false, error: '{code}' },
  success: { ok: true },
  // Known operations outside the product/app-life slate stay in the declared spec surface and answer the gap.
  unmodeled: ["admin_analytics_getFile", "admin_apps_activities_list", "admin_apps_approve", "admin_apps_approved_list", "admin_apps_config_lookup", "admin_apps_config_set", "admin_apps_requests_cancel", "admin_apps_requests_list", "admin_apps_restrict", "admin_apps_restricted_list", "admin_audit_anomaly_allow_getItem", "admin_audit_anomaly_allow_updateItem", "admin_auth_policy_assignEntities", "admin_auth_policy_getEntities", "admin_auth_policy_removeEntities", "admin_barriers_create", "admin_barriers_delete", "admin_barriers_list", "admin_barriers_update", "admin_conversations_archive", "admin_conversations_convertToPrivate", "admin_conversations_create", "admin_conversations_delete", "admin_conversations_disconnectShared", "admin_conversations_ekm_listOriginalConnectedChannelInfo", "admin_conversations_getConversationPrefs", "admin_conversations_getCustomRetention", "admin_conversations_getTeams", "admin_conversations_invite", "admin_conversations_removeCustomRetention", "admin_conversations_rename", "admin_conversations_restrictAccess_addGroup", "admin_conversations_restrictAccess_listGroups", "admin_conversations_restrictAccess_removeGroup", "admin_conversations_search", "admin_conversations_setConversationPrefs", "admin_conversations_setCustomRetention", "admin_conversations_setTeams", "admin_conversations_unarchive", "admin_emoji_add", "admin_emoji_addAlias", "admin_emoji_list", "admin_emoji_remove", "admin_emoji_rename", "admin_functions_list", "admin_functions_permissions_lookup", "admin_functions_permissions_set", "admin_inviteRequests_approve", "admin_inviteRequests_approved_list", "admin_inviteRequests_denied_list", "admin_inviteRequests_deny", "admin_inviteRequests_list", "admin_roles_addAssignments", "admin_roles_listAssignments", "admin_roles_removeAssignments", "admin_teams_admins_list", "admin_teams_create", "admin_teams_list", "admin_teams_owners_list", "admin_teams_settings_info", "admin_teams_settings_setDefaultChannels", "admin_teams_settings_setDescription", "admin_teams_settings_setDiscoverability", "admin_teams_settings_setIcon", "admin_teams_settings_setName", "admin_usergroups_addChannels", "admin_usergroups_addTeams", "admin_usergroups_listChannels", "admin_usergroups_removeChannels", "admin_users_assign", "admin_users_invite", "admin_users_list", "admin_users_remove", "admin_users_session_clearSettings", "admin_users_session_getSettings", "admin_users_session_invalidate", "admin_users_session_list", "admin_users_session_reset", "admin_users_session_resetBulk", "admin_users_session_setSettings", "admin_users_setAdmin", "admin_users_setExpiration", "admin_users_setOwner", "admin_users_setRegular", "admin_users_unsupportedVersions_export", "admin_workflows_collaborators_add", "admin_workflows_collaborators_remove", "admin_workflows_permissions_lookup", "admin_workflows_search", "admin_workflows_unpublish", "apps_event_authorizations_list", "apps_permissions_info", "apps_permissions_request", "apps_permissions_resources_list", "apps_permissions_scopes_list", "apps_permissions_users_list", "apps_permissions_users_request", "audit_v1_actions", "audit_v1_logs", "audit_v1_schemas", "bookmarks_add", "bookmarks_edit", "bookmarks_list", "bookmarks_remove", "calls_add", "calls_end", "calls_info", "calls_participants_add", "calls_participants_remove", "calls_update", "canvases_access_delete", "canvases_access_set", "canvases_create", "canvases_delete", "canvases_edit", "canvases_sections_lookup", "conversations_canvases_create", "conversations_close", "conversations_externalInvitePermissions_set", "dialog_open", "dnd_endDnd", "dnd_teamInfo", "files_comments_add", "files_comments_delete", "files_comments_list", "files_remote_add", "files_remote_info", "files_remote_list", "files_remote_remove", "files_remote_share", "files_remote_update", "files_revokePublicURL", "files_sharedPublicURL", "functions_completeError", "functions_completeSuccess", "migration_exchange", "oauth_access", "oauth_token", "openid_connect_token", "openid_connect_userInfo", "reactions_list", "reminders_add", "reminders_complete", "reminders_delete", "reminders_info", "reminders_list", "rtm_connect", "search_all", "search_files", "search_messages", "stars_add", "stars_list", "stars_remove", "team_accessLogs", "team_billableInfo", "team_integrationLogs", "team_preferences_list", "team_profile_get", "users_deletePhoto", "users_identity", "users_setActive", "users_setPhoto", "views_open", "views_push", "views_update", "workflows_stepCompleted", "workflows_stepFailed", "workflows_triggers_create", "workflows_triggers_delete", "workflows_triggers_list", "workflows_triggers_update", "workflows_updateStep"],
  readOnly: { status: 200, code: 'read_only', message: 'twin is read-only; omit readOnly to accept writes' },
  notFound: { status: 200, code: 'not_found', message: 'not_found' },
  gap: { status: 404, code: 'unknown_method', message: 'unknown_method' },
  deleted: { ok: true },
  // a list's pages: `limit` and the opaque `cursor`, the next in `response_metadata.next_cursor`, empty on the last
  // (https://docs.slack.dev/apis/web-api/pagination)
  list: { style: 'envelope', envelope: { response_metadata: { next_cursor: '{next_cursor}' } }, limit: { param: 'limit', default: 100, max: 1000 }, cursor: { param: 'cursor', encoding: 'base64-offset' } },
  resources: {
    team: { idPrefix: 'T0', ...states.team, refresh: { get: 'team_info' } },
    user: { idPrefix: 'U0', ...states.user, refresh: { list: 'users_list', items: 'members' } },
    // conversations.list asked for every type ("Mix and match channel types by providing a comma-separated list of any
    // combination of public_channel, private_channel, mpim, im"), DMs among them; a token lists only what it can see: not
    // the whole type
    // source: https://docs.slack.dev/reference/methods/conversations.list "Mix and match channel types by providing a comma-separated list of any combination of"
    channel: { idPrefix: 'C0', ...states.channel, refresh: { list: 'conversations_list', query: { types: 'public_channel,private_channel,mpim,im' }, complete: false } },
    im: { storedAs: 'channel', idPrefix: 'D0', refresh: { none: "a DM is stored as a channel: the channel's scope reads it (conversations.list asks every type, im among them)" } },
    // a message is its channel's and its ts (`<channel>:<ts>`), read by its channel's history
    // a message Slack makes and answers no id for (conversations.join's channel_join) is the vendor's copy with its subtype
    // and its user, which a refresh adopts it by
    // source: https://docs.slack.dev/reference/events/message/channel_join "A member joined a channel"
    message: { idPrefix: 'M', key: '{channel}:{ts}', parent: { resource: 'channel', field: 'channel', param: 'channel' }, refresh: { list: 'conversations_history' }, adoptBy: ['subtype', 'user'] },
    scheduled_message: { idPrefix: 'Q0', refresh: { list: 'chat_scheduledMessages_list', items: 'scheduled_messages' } },
    // files.list pages by `page`, past which the twin does not page: not the whole type
    file: { idPrefix: 'F0', refresh: { list: 'files_list', items: 'files', complete: false } },
    // usergroups.list leaves out disabled groups unless asked, and answers every group at once: asked for them, the whole
    // type
    // source: https://docs.slack.dev/reference/methods/usergroups.list "Include results for disabled User Groups."
    usergroup: { idPrefix: 'S0', ...states.usergroup, refresh: { list: 'usergroups_list', query: { include_disabled: 'true' }, unpaginated: true } },
    app: { idPrefix: 'A0', refresh: { none: "an app is its developer's: apps.manifest.export reads one only with its developer's app configuration token, which no workspace's credential is, and the Web API lists no workspace's apps" } },
    bot: { idPrefix: 'B0', refresh: { none: 'no bot row is kept: a bot is stored as its bot user (`user`, is_bot and bot_id), which the user refresh reads back (users.list)' } },
    invite_request: { idPrefix: 'Ir', ...states.invite_request, refresh: { none: "an ordinary workspace's invitation requests are read only on its admin pages: the API that lists them (admin.inviteRequests.list) is Enterprise Grid's org admin API, which no ordinary workspace's credential calls" } },
    invitation: { idPrefix: 'Iv', refresh: { none: 'an invitation is an email Slack sent; nothing reads it back' } },
    // Pending outgoing Connect invitations use the list item's nested vendor identity, not a second workspace member.
    // source: https://docs.slack.dev/reference/methods/conversations.listConnectInvites "pending shared channel invitations"
    connect_invite: { idPrefix: 'I0', ids: '{prefix}{letters:9}', key: '{invite.id}', refresh: { list: 'conversations_listConnectInvites', items: 'invites', idAs: 'invite.id', complete: false } },
    // emoji.list: "Lists custom emoji for a team", each name to its image URL (or an alias): the name kept as the field it is
    // source: https://docs.slack.dev/reference/methods/emoji.list "Lists custom emoji for a team."
    emoji: { idPrefix: 'E', key: '{name}', refresh: { list: 'emoji_list', keyed: true, items: 'emoji', unpaginated: true, shape: { value: 'url', keyAs: 'name' } } },
    incoming_webhook: { idPrefix: 'B0W', refresh: { none: "a webhook's URL is a secret shown once, at its install; nothing reads it back" } },
    // the sets, one subject per member (the tree contract): a conversation's members, a person's workspaces, a
    // message's reactions and pins, a user group's members and default channels, and an app's installs; each names what
    // it joins (`embeds`), so a subject the vendor gives another id keeps its members
    // source: https://docs.slack.dev/reference/methods/conversations.members "Retrieve members of a conversation."
    channel_member: { idPrefix: '', embeds: { _channel: 'channel', _user: 'user' }, parent: { resource: 'channel', field: '_channel', param: 'channel' }, key: '{_channel}::{_user}', refresh: { list: 'conversations_members', items: 'members', shape: { scalar: '_user' } } },
    // a person's membership of the workspace, read as its people: each user's id and team_id
    // source: https://docs.slack.dev/reference/methods/users.list "Lists all users in a Slack team."
    team_member: { idPrefix: '', embeds: { _team: 'team', _user: 'user' }, key: '{_team}::{_user}', refresh: { list: 'users_list', items: 'members', shape: { spread: { path: 'id', as: '_user', carry: { _team: 'team_id' } } } } },
    // a message's reactions, grouped by emoji with the people who reacted (`full` for every one of them)
    // source: https://docs.slack.dev/reference/methods/reactions.get "Gets reactions for an item."
    reaction: { idPrefix: '', embeds: { _message: 'message', user: 'user' }, parent: { resource: 'message', field: '_message', params: ['channel', 'timestamp'], where: { channel: '{channel}', ts: '{timestamp}' }, value: '{channel}:{timestamp}' }, key: '{_message}::{reaction}::{user}', refresh: { list: 'reactions_get', items: 'message.reactions', query: { full: 'true' }, unpaginated: true, shape: { spread: { path: 'users', as: 'user', carry: { reaction: 'name' } } } } },
    // a channel's pins, each embedding its message: the message's ts kept as `_ts`
    // source: https://docs.slack.dev/reference/methods/pins.list "Lists items pinned to a channel."
    pin: { idPrefix: '', embeds: { _message: 'message', channel: 'channel' }, parent: { resource: 'channel', field: 'channel', param: 'channel' }, key: '{channel}::{_ts}', refresh: { list: 'pins_list', items: 'items', unpaginated: true, shape: { spread: { path: 'message.ts', as: '_ts', carry: { type: 'type', created: 'created', created_by: 'created_by' } } } } },
    // source: https://docs.slack.dev/reference/methods/usergroups.users.list "List all users in a User Group."
    usergroup_member: { idPrefix: '', embeds: { _usergroup: 'usergroup', _user: 'user' }, parent: { resource: 'usergroup', field: '_usergroup', param: 'usergroup' }, key: '{_usergroup}::{_user}', refresh: { list: 'usergroups_users_list', items: 'users', query: { include_disabled: 'true' }, unpaginated: true, shape: { scalar: '_user' } } },
    // a group's default channels, read inside each group (prefs.channels), disabled groups included
    // source: https://docs.slack.dev/reference/methods/usergroups.list "Include results for disabled User Groups."
    usergroup_channel: { idPrefix: '', embeds: { _usergroup: 'usergroup', _channel: 'channel' }, key: '{_usergroup}::{_channel}', refresh: { list: 'usergroups_list', items: 'usergroups', query: { include_disabled: 'true' }, unpaginated: true, shape: { spread: { path: 'prefs.channels', as: '_channel', carry: { _usergroup: 'id' } } } } },
    app_install: { idPrefix: '', embeds: { app: 'app', team: 'team' }, refresh: { none: "an app's install is its token's: the Web API lists no workspace's installs" } },
    // what a person does in the client that Slack tells an app of: opening its Home tab, sharing a link; and the Home
    // tab an app publishes for a person, and a message only one person sees
    home_open: { idPrefix: '', refresh: { none: 'a person opening a Home tab is an event Slack sends an app, not state it reads back' } },
    link_share: { idPrefix: '', refresh: { none: 'a shared link is an event Slack sends an app, not state it reads back' } },
    home_view: { idPrefix: 'V0', refresh: { none: 'views.publish answers the view; nothing reads a published Home back' } },
    // bookkeeping each numbered from the tree: the mail Slack sent, what it sent apps, and each code's or token's draw
    _mail: { idPrefix: '' },
    _delivery: { idPrefix: '' },
    _serial: { idPrefix: '' },
    ephemeral: { idPrefix: '', refresh: { none: 'Slack keeps no ephemeral message to read' } },
  },
  // what GET /twin says this twin is
  discovery: {
    twinOf: "Slack's Web API, its OAuth install, the conversation client, sign-up, invitations, the admin pages, the app settings and incoming webhooks",
    stores: 'the workspace, people, channels and their messages, threads, reactions and pins, files, user groups, apps and their tokens, invitations',
    identity: 'a person acts with their own client token, xoxp-<user id>; an app with the tokens its install makes',
  },
  // the World's doors (./semantics/doors.ts): what stands in for acts outside Slack's API and pages
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the World's own app, installed in its workspace: the tokens and signing secret its application holds, as the runtime issues them at every boot" },
    { id: 'apps', method: 'POST', path: '/_twin/apps', note: "an app another workspace made from its manifest and distributed publicly: its credentials" },
    { id: 'command', method: 'POST', path: '/_twin/client/command', note: 'a person runs a slash command in the Slack client: the command is sent to its app' },
    { id: 'home', method: 'POST', path: '/_twin/client/home', note: "a person opens an app's Home tab in the client: the app is sent app_home_opened" },
    { id: 'link', method: 'POST', path: '/_twin/client/link', note: "a person's message shares a link: the apps whose unfurl domains take it are sent link_shared" },
    { id: 'action', method: 'POST', path: '/_twin/client/action', note: "a person presses a button in an app's message: the app is sent the block_actions payload" },
    { id: 'deliveries', method: 'GET', path: '/_twin/deliveries', note: "what Slack sent an app's server (?to=<url>)" },
    { id: 'mail', method: 'GET', path: '/_twin/mail', note: "the emails Slack sent a person (?to=<address>): their inbox" },
  ],
  // The pages people use and the hosts Slack serves beside its API (docs/contributing/architecture.md, "Screens")
  sockets: [{
    id: 'socketMode', path: '/link',
    note: "Socket Mode: an app's WebSocket in place of its Request URL (hello, then events_api, slash_commands and interactive envelopes, each acknowledged by its envelope_id); apps.connections.open answers where it is",
    source: 'https://docs.slack.dev/apis/events-api/using-socket-mode',
  }],
  screens: [
    {
      // source: https://slack.com/help/articles/221769328-Locate-your-Slack-URL-or-ID "https://app.slack.com/client/TXXXXXXX/CXXXXXXX"
      // source: https://slack.com/help/articles/360059928654-How-to-use-Slack--your-quick-start-guide "open your direct messages"
      id: 'client', kind: 'workspace', host: 'app.slack.com', path: '/client', status: 'done',
      demand: 'a teammate inspects an agent handoff in its actual channel and thread, and continues the conversation',
      controls: ['Home', 'DMs', 'Channels', 'Direct messages', 'Reply in thread', 'Close thread', 'Message', 'Send now', 'Reply', 'Also send to channel', 'Join Channel', 'New message'],
      source: 'https://slack.com/help/articles/360059928654-How-to-use-Slack--your-quick-start-guide',
    },
    {
      id: 'signin', kind: 'flow', host: 'slack.com', hosts: ['app.slack.com'], path: '/signin', status: 'done',
      demand: 'a browser opens OAuth consent as an existing workspace member', controls: ['Email', 'Sign In with Email', 'Confirmation code', 'Continue'],
      source: 'https://slack.com/help/articles/212681477-Sign-in-to-Slack',
    },
    {
      id: 'get-started', kind: 'flow', host: 'slack.com', path: '/get-started', status: 'done',
      demand: 'a workspace exists only once someone creates it here', controls: ['Email', 'Full name', 'Create workspace'],
      source: 'https://slack.com/help/articles/206845317-Create-a-Slack-workspace',
    },
    {
      id: 'invite', kind: 'flow', host: 'slack.com', path: '/invite', status: 'done',
      demand: 'people join a workspace by invitation', controls: ['Email', 'Reason', 'Send'],
      source: 'https://slack.com/help/articles/201330256-Invite-new-members-to-your-workspace',
    },
    {
      id: 'join', kind: 'flow', host: 'slack.com', path: '/join', status: 'done',
      demand: "an invitation's Join Now link", controls: ['Full name', 'Join'],
      source: 'https://slack.com/help/articles/212675257-Join-a-Slack-workspace',
    },
    {
      id: 'admin', kind: 'workspace', host: 'slack.com', path: '/admin', status: 'done',
      demand: "a workspace's owners and admins manage members and approve invitation requests",
      controls: ['Deactivate account', 'Activate account', 'Make Workspace Admin', 'Approve', 'Deny'],
      source: 'https://slack.com/help/articles/360052445454-Manage-members-and-their-roles',
    },
    {
      id: 'account', kind: 'workspace', host: 'slack.com', path: '/account', status: 'done',
      demand: 'a person sets the hours they take notifications in; outside them Do Not Disturb is on', controls: ['Notification schedule', 'From', 'To', 'Save'],
      source: 'https://slack.com/help/articles/214908388-Pause-notifications-with-Do-Not-Disturb',
    },
    {
      id: 'manage-apps', kind: 'workspace', host: 'slack.com', path: '/apps/manage', status: 'done',
      demand: "a workspace's members remove an app the workspace installed", controls: ['Remove App'],
      source: 'https://slack.com/help/articles/360003125231-Remove-apps-and-custom-integrations-from-your-workspace',
    },
    {
      id: 'apps', kind: 'workspace', host: 'api.slack.com', path: '/apps', status: 'done',
      demand: "a developer's apps and the app configuration tokens the manifest API takes", controls: ['Generate Token'],
      source: 'https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests',
    },
    {
      id: 'oauth', kind: 'flow', host: 'slack.com', path: '/oauth/v2/authorize', status: 'done',
      demand: 'every app is installed here: the scopes it asks for, allowed or denied', controls: ['Allow', 'Cancel', 'Post to'],
      source: 'https://docs.slack.dev/authentication/installing-with-oauth',
    },
    {
      id: 'incoming-webhooks', kind: 'content', host: 'hooks.slack.com', path: '/services', status: 'done',
      demand: "an install's incoming webhook: a message posted to its URL lands in its channel",
      source: 'https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks',
    },
    {
      // after the incoming webhooks, which take /services: the response URLs, /actions/… and /commands/…
      id: 'response-url', kind: 'content', host: 'hooks.slack.com', path: '/', status: 'done',
      demand: "a response_url a command or an interaction hands its app: its reply replaces the message, or posts in the channel or to the person alone",
      source: 'https://docs.slack.dev/interactivity/handling-user-interaction#message_responses',
    },
    {
      id: 'files', kind: 'content', host: 'files.slack.com', path: '/upload', status: 'done',
      demand: "files.getUploadURLExternal's upload URL, where a client sends a file's bytes",
      source: 'https://docs.slack.dev/messaging/working-with-files#uploading_files',
    },
  ],
  // a vendor-backed World's root: Slack's Events API sends a workspace's messages to the World's ingest door, signed as
  // Slack signs every request it sends (https://docs.slack.dev/authentication/verifying-requests-from-slack), the
  // Request URL verified first with its challenge (https://docs.slack.dev/reference/events/url_verification)
  ingest: {
    scheme: { kind: 'hmac', header: 'X-Slack-Signature', encoding: 'hex', prefix: 'v0=', timestampHeader: 'X-Slack-Request-Timestamp', signed: 'v0:{t}:{body}' },
    type: { body: 'event.type' }, object: 'event',
    types: { message: { resource: 'message' } },
    handshake: { when: { type: 'url_verification' }, answer: '$body.challenge' },
  },
  // the Web API's limits, per workspace and app: Tier 3 for most reads and writes, Tier 2 for a channel's creation and its
  // settings
  // source: https://docs.slack.dev/apis/web-api/rate-limits "50+ per minute"
  // source: https://docs.slack.dev/apis/web-api/rate-limits "20+ per minute"
  rateBudget: {
    // the vendor's documented allowance this budget stays inside (cited above)
    allowance: { perMinute: 50, source: 'https://docs.slack.dev/apis/web-api/rate-limits' },
    reason: 'Slack rate-limits each Web API method per workspace and app by tier: Tier 3 50+ a minute, Tier 2 20+ (https://docs.slack.dev/apis/web-api/rate-limits)',
    windowMs: 60_000, ceiling: 100, defaultWeight: 2, maxRetryAfterSeconds: 300,
    rules: [{ match: '^POST /api/conversations\\.(create|rename|archive|unarchive|setPurpose|setTopic|invite|kick)$', weight: 5 }],
  },
  // the pack as the World registers it (world-core packRegistry)
  descriptor: {
    protocol: '3',
    transport: 'web-api',
    archetype: 'crud',
    bin: 'world-slack',
    resources: ['team', 'user', 'channel', 'message', 'file', 'usergroup', 'app'],
    credentialDoor: { path: '/_twin/app-credentials', body: {}, fill: { SLACK_BOT_TOKEN: 'bot_token', SLACK_TOKEN: 'bot_token', SLACK_APP_TOKEN: 'app_token', SLACK_SIGNING_SECRET: 'signing_secret', SLACK_CLIENT_ID: 'client_id', SLACK_CLIENT_SECRET: 'client_secret' } },
    specSource: "Slack's Web API OpenAPI document (spec/, provenance in spec/SOURCE.md)",
    description: "Slack Web API twin — an org and its workspaces, people, channels, messages and threads, files, apps and their OAuth install, and the pages people use.",
    // the Web API/OAuth SDKs and Bolt, in both languages, the whole `@slack/` scope, and the SLACK_* credential stems
    adoption: {
      pypi: ['slack-sdk', 'slack-bolt', 'slackclient'],
      sdks: ['@slack/web-api', '@slack/bolt', '@slack/webhook', '@slack/oauth', '@chat-adapter/slack'],
      scopes: ['@slack/'],
      envStems: ['SLACK', 'SLACKBOTUSER'],
    },
    hosts: [
      // source: https://slack.com/help/articles/221769328-Locate-your-Slack-URL-or-ID "https://app.slack.com/client/TXXXXXXX/CXXXXXXX"
      { host: 'app.slack.com' },
      { host: 'slack.com' }, { host: 'www.slack.com' }, { host: 'api.slack.com' }, 
      { host: 'hooks.slack.com', pathPattern: '^/services/' }, { host: 'files.slack.com', pathPattern: '^/upload/' },
    ],
  },
  // the Events API: the events a workspace's activity sends an app that subscribed to them (./semantics/shared.ts)
  events: { ...SLACK_EVENTS, render: data, values },
};
