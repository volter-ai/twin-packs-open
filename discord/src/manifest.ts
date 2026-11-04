// Discord's manifest: the vendor facts its spec (../spec, discord/discord-api-spec) does not carry. Served is what the
// demand's applications call as they ship and what the life builds and reads through the API (../journeys/demand.json,
// ../journeys/decisions.json): OAuth2 (the authorize page's bot install, the token URL, the current authorization),
// the current user and its application with its global slash commands, guilds, channels, roles and members, messages with their edits, threads and
// reactions, a typing indicator, webhooks and invites, the bot's servers a refresh reads, and the Gateway (a socket,
// spoken by ./semantics/sockets.ts). Every route is permission-checked, so each is a handler; the spec's other
// operations are `unmodeled` and answer the vendor's gap. Nothing is stored by a request's count: ids are snowflakes
// (the kernel's `{snowflake:E}`), a member and a reaction one subject per member. Every path is the spec's own, under
// its server URL `/api/v10` (the surface's basePath).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'discord',
  service: 'discord',
  // the versions Discord serves at once: an unversioned path and v9 routed as the spec's v10 (the twin answers v10's shapes)
  // source: https://docs.discord.com/developers/reference "Omitting the version number from the route will route requests to the current default version"
  basePathAlias: '/api(?:/v\\d+)?',
  body: { json: 'always' },
  // source: https://docs.discord.com/developers/reference "snowflake format for uniquely identifiable descriptors"
  ids: { template: '{snowflake:1420070400000}' },
  time: 'iso',
  // source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "Example JSON Error Response"
  error: { message: '{message}', code: '{code}' },
  readOnly: { status: 403, code: 50013, message: 'Missing Permissions' },
  notFound: { status: 404, code: 0, message: '404: Not Found' },
  gap: { status: 404, code: 0, message: '404: Not Found' },
  // the operations the pack does not serve: each answers the vendor's gap
  unmodeled: ["action_guild_join_request", "add_group_dm_user", "add_guild_member", "add_guild_member_role", "add_invite_target_user", "add_lobby_member", "add_thread_member", "applications_get_activity_instance", "ban_user_from_guild", "bot_partner_sdk_token", "bot_partner_sdk_unmerge_provisional_account", "bulk_add_invite_target_users", "bulk_ban_users_from_guild", "bulk_delete_messages", "bulk_remove_invite_target_users", "bulk_set_application_commands", "bulk_set_guild_application_commands", "bulk_update_guild_channels", "bulk_update_guild_roles", "bulk_update_lobby_members", "consume_entitlement", "count_guild_scheduled_event_users", "create_application_emoji", "create_auto_moderation_rule", "create_dm", "create_entitlement", "create_guild_application_command", "create_guild_emoji", "create_guild_scheduled_event", "create_guild_scheduled_event_exception", "create_guild_soundboard_sound", "create_guild_sticker", "create_guild_template", "create_linked_lobby_guild_invite_for_self", "create_linked_lobby_guild_invite_for_user", "create_lobby", "create_lobby_message", "create_or_join_lobby", "create_pin", "create_stage_instance", "create_thread", "crosspost_message", "delete_all_message_reactions", "delete_all_message_reactions_by_emoji", "delete_application_emoji", "delete_application_user_role_connection", "delete_auto_moderation_rule", "delete_channel", "delete_channel_permission_overwrite", "delete_entitlement", "delete_group_dm_user", "delete_guild_application_command", "delete_guild_emoji", "delete_guild_integration", "delete_guild_member", "delete_guild_member_role", "delete_guild_role", "delete_guild_scheduled_event", "delete_guild_scheduled_event_exception", "delete_guild_soundboard_sound", "delete_guild_sticker", "delete_guild_template", "delete_lobby", "delete_lobby_member", "delete_message", "delete_pin", "delete_stage_instance", "delete_thread_member", "delete_user_message_reaction", "delete_webhook", "delete_webhook_by_token", "delete_webhook_message", "deprecated_create_pin", "deprecated_delete_pin", "deprecated_list_pins", "edit_lobby", "edit_lobby_channel_link", "execute_github_compatible_webhook", "execute_slack_compatible_webhook", "follow_channel", "get_active_guild_threads", "get_answer_voters", "get_application", "get_application_command", "get_application_emoji", "get_application_role_connections_metadata", "get_application_user_role_connection", "get_auto_moderation_rule", "get_current_user_application_entitlements", "get_entitlement", "get_entitlements", "get_gateway", "get_guild", "get_guild_application_command", "get_guild_application_command_permissions", "get_guild_ban", "get_guild_emoji", "get_guild_join_requests", "get_guild_member", "get_guild_new_member_welcome", "get_guild_preview", "get_guild_role", "get_guild_scheduled_event", "get_guild_soundboard_sound", "get_guild_sticker", "get_guild_template", "get_guild_vanity_url", "get_guild_welcome_screen", "get_guild_widget", "get_guild_widget_png", "get_guild_widget_settings", "get_guilds_onboarding", "get_invite_target_users", "get_invite_target_users_job_status", "get_lobby", "get_lobby_messages", "get_message", "get_my_guild_member", "get_openid_connect_userinfo", "get_original_webhook_message", "get_public_keys", "get_self_voice_state", "get_sku_subscription", "get_sku_subscriptions", "get_soundboard_default_sounds", "get_stage_instance", "get_sticker", "get_sticker_pack", "get_thread_member", "get_user", "get_voice_state", "get_webhook", "get_webhook_by_token", "get_webhook_message", "guild_role_member_counts", "guild_search", "invite_revoke", "join_thread", "leave_guild", "leave_lobby", "leave_thread", "list_application_emojis", "list_auto_moderation_rules", "list_channel_invites", "list_channel_webhooks", "list_guild_application_command_permissions", "list_guild_application_commands", "list_guild_audit_log_entries", "list_guild_bans", "list_guild_emojis", "list_guild_integrations", "list_guild_members", "list_guild_scheduled_event_exception_users", "list_guild_scheduled_event_users", "list_guild_scheduled_events", "list_guild_soundboard_sounds", "list_guild_stickers", "list_guild_templates", "list_guild_voice_regions", "list_message_reactions_by_emoji", "list_my_connections", "list_my_private_archived_threads", "list_pins", "list_private_archived_threads", "list_public_archived_threads", "list_sticker_packs", "list_thread_members", "list_voice_regions", "partner_sdk_token", "partner_sdk_unmerge_provisional_account", "poll_expire", "preview_prune_guild", "prune_guild", "put_guilds_onboarding", "remove_invite_target_user", "send_soundboard_sound", "set_channel_permission_overwrite", "set_guild_application_command_permissions", "sync_guild_template", "thread_search", "unban_user_from_guild", "update_application", "update_application_emoji", "update_application_role_connections_metadata", "update_application_user_role_connection", "update_auto_moderation_rule", "update_channel", "update_guild", "update_guild_application_command", "update_guild_emoji", "update_guild_incident_actions", "update_guild_member", "update_guild_role", "update_guild_scheduled_event", "update_guild_scheduled_event_exception", "update_guild_soundboard_sound", "update_guild_sticker", "update_guild_template", "update_guild_welcome_screen", "update_guild_widget_settings", "update_invite_target_users", "update_lobby_message_external_moderation_metadata", "update_my_application", "update_my_user", "update_self_voice_state", "update_stage_instance", "update_user_message_external_moderation_metadata", "update_voice_channel_status", "update_voice_state", "update_webhook", "update_webhook_by_token", "update_webhook_message", "upload_application_attachment"],
  list: { style: 'envelope', envelope: '{data}', limit: { param: 'limit', default: 50, max: 100 } },
  deleted: {},
  resources: {
    // the vendor's objects, each stored as Discord answers it (with what the twin keeps beside it under `_`)
    // a vendor-backed World reads each back (the real-system adapters, "Refresh"): the bot's own application, and
    // under each server its roles
    user: { idPrefix: '', unique: [{ fields: ['_username'], refusal: { status: 409, message: 'Username is unavailable. Try adding numbers, letters, underscores _, or periods.' } }], refresh: { none: 'Discord lists no users: a person is read one at a time by id (get_user), and the caller itself with users/@me' } },
    application: { idPrefix: '', refresh: { get: 'get_my_application' } },
    // an application's global slash commands, listed whole (the list takes no paging)
    // source: https://docs.discord.com/developers/interactions/application-commands "Fetch all of the global commands for your application."
    command: { idPrefix: '', ...states.command, parent: { resource: 'application', field: 'application_id', param: 'application_id' }, refresh: { list: 'list_application_commands', items: '$body', unpaginated: true } },
    guild: { idPrefix: '', refresh: { list: 'list_my_guilds', items: '$body' } },
    // a guild's roles, listed whole (the list takes no paging)
    // source: https://docs.discord.com/developers/resources/guild "Returns a list of role objects for the guild."
    role: { idPrefix: '', parent: { resource: 'guild', field: '_guild', param: 'guild_id' }, refresh: { list: 'list_guild_roles', unpaginated: true } },
    // `{guild}:{user}`: one subject per member of a guild
    member: { idPrefix: '', refresh: { none: "a member has no id of its own (the World keeps it as <guild>:<user>), and list_guild_members names its user only nested, under the privileged GUILD_MEMBERS intent" } },
    channel: { idPrefix: '', ...states.channel, parent: { resource: 'guild', field: 'guild_id', param: 'guild_id' }, refresh: { list: 'list_guild_channels', items: '$body', complete: false } },
    message: { idPrefix: '', ...states.message, parent: { resource: 'channel', field: 'channel_id', param: 'channel_id' }, refresh: { list: 'list_messages', items: '$body', complete: false } },
    // `{message}:{emoji}:{user}`: one subject per member of a reaction
    reaction: { idPrefix: '', refresh: { none: "a reaction is read with its message (its emoji and count); list_message_reactions_by_emoji answers users, not reactions with ids" } },
    webhook: { idPrefix: '', parent: { resource: 'guild', field: 'guild_id', param: 'guild_id' }, refresh: { list: 'get_guild_webhooks', items: '$body' } },
    // an invite is named by its code, which Discord answers as `code`
    invite: { idPrefix: '', ids: '{letters:10}', idAs: 'code', ...states.invite, parent: { resource: 'guild', field: '_guild', param: 'guild_id' }, refresh: { list: 'list_guild_invites', items: '$body' } },
    // an attachment's snowflake, recorded so no later id repeats it
    // Interaction delivery and token custody are transient bookkeeping, not a refreshed vendor resource.
    _interaction: { idPrefix: '', ...states._interaction },
    _attachment: { idPrefix: '' },
    // a command's version, a snowflake of its own on each change, recorded so no later id repeats it
    _command_version: { idPrefix: '' },
    // a bot's identify on the Gateway: its session start limit is counted from them
    _identify: { idPrefix: 'identify_', ids: '{prefix}{n}' },
    _code: { idPrefix: 'code_', ids: '{prefix}{n}' },
    _access_token: { idPrefix: 'at_', ids: '{prefix}{n}' },
    _refresh_token: { idPrefix: 'rt_', ids: '{prefix}{n}' },
    _bot_token: { idPrefix: 'bt_', ids: '{prefix}{n}' },
    _client_secret: { idPrefix: 'cs_', ids: '{prefix}{n}' },
  },
  screens: [{
    id: 'authorize', kind: 'flow', host: 'discord.com', path: '/oauth2/authorize',
    demand: 'the life adds its own bot by the portal\'s install link (bot)', status: 'done',
    controls: ['Log in', 'Select a server', 'Authorize', 'Cancel'], source: 'https://docs.discord.com/developers/topics/oauth2',
  }],
  sockets: [{
    id: 'gateway', path: '/',
    note: "the Gateway: a bot's WebSocket (HELLO, IDENTIFY, READY, GUILD_CREATE, MESSAGE_CREATE and _UPDATE, THREAD_CREATE, INTERACTION_CREATE, MESSAGE_REACTION_ADD and _REMOVE as its intents ask); `GET /gateway/bot` answers where it is, and gateway.discord.gg serves it too",
    source: 'https://docs.discord.com/developers/events/gateway',
  }],
  doors: [
    { id: 'interact', method: 'POST', path: '/_twin/channels/{channel}/interactions', note: '{ username, application_id, command?, options?, type?, message_id?, custom_id? }: a person invokes a command, requests autocomplete or uses a component in the Discord client; delivered to the application on the Gateway' },
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "{ account?, deployment?, name?, owner?, redirect_uris?, bot_public?, privileged_intents? }: the Developer Portal's application (made by owner, a person signed in to the portal): its client id and secret, its bot's token, its public key" },
    { id: 'people', method: 'POST', path: '/_twin/people', note: '{ username, password, global_name?, email? }: a Discord account' },
    { id: 'guilds', method: 'POST', path: '/_twin/guilds', note: "{ owner, name }: a person creates a server in the client (@everyone, #general, General)" },
    { id: 'acceptInvite', method: 'POST', path: '/_twin/invites/{code}/accept', note: '{ username }: a person accepts an invite in the client' },
    { id: 'post', method: 'POST', path: '/_twin/channels/{channel}/messages', note: '{ username, content }: a person posts in the client' },
    { id: 'react', method: 'PUT', path: '/_twin/channels/{channel}/messages/{message}/reactions', note: '{ username, emoji }: a person reacts to a message in the client' },
  ],
  // the API's limits (https://docs.discord.com/developers/topics/rate-limits): each route's own bucket, which the vendor
  // answers in its X-RateLimit headers, under a bot's global limit of 50 requests a second
  // source: https://docs.discord.com/developers/topics/rate-limits "All bots can make up to 50 requests per second to our API."
  // source: https://docs.discord.com/developers/topics/rate-limits "Currently, this limit is 10,000 per 10 minutes"
  rateBudget: {
    // the vendor's documented allowance this budget stays inside (cited above)
    allowance: { perMinute: 3000, source: 'https://docs.discord.com/developers/topics/rate-limits' },
    reason: "Discord's global rate limit is 50 requests a second for a bot (https://docs.discord.com/developers/topics/rate-limits); each route's bucket is narrower (announced in X-RateLimit headers, not documented as numbers) and 10,000 invalid requests in 10 minutes restrict the address, so the World spends a fifth of the global limit: 10 a second",
    windowMs: 60_000, ceiling: 600, defaultWeight: 1, maxRetryAfterSeconds: 300,
  },
  discovery: {
    twinOf: "Discord's API v10 as apps use it: OAuth2 (a bot's install), the current user and application, an application's global slash commands, guilds, channels, roles and members, messages, threads and reactions, webhooks and invites, and the Gateway",
    stores: 'people and applications (secrets and tokens by their SHA-256) with their global commands, servers with their roles, members and channels, messages with their reactions, webhooks and invites',
    identity: '`Authorization: Bot <token>` (the portal door) or `Bearer <token>` (OAuth2)',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-discord',
    resources: ['user', 'application', 'command', 'guild', 'role', 'member', 'channel', 'message', 'reaction', 'webhook', 'invite'],
    specSource: 'discord/discord-api-spec specs/openapi.json (API v10), vendored in spec/ (provenance in spec/SOURCE.md)',
    description: "Discord twin — OAuth2, global slash commands, guilds, channels, roles and members, messages, threads, reactions, webhooks, invites and the Gateway, as Open Autonomy's Hermes, Volter Harness and Cal.com call them.",
    adoption: { sdks: ['discord.js', '@discordjs/rest', '@discordjs/core', 'discord-api-types', 'passport-discord', '@chat-adapter/discord'], envStems: ['DISCORD'] },
    // the npm clients above name Discord in an application (what the demand scan reads); none is Discord's own
    // source: https://docs.discord.com/developers/developer-tools/community-resources "Discord does not maintain official SDKs."
    clientCasesNone: "Discord maintains no official SDK (its libraries page lists third parties' only): the demand's applications call its API with fetch (Cal.com, Open Autonomy's setup) or a community library (Hermes's discord.py, Volter Harness's discord.js under the Chat SDK)",
    // the Gateway's own host, which discord.py dials without asking GET /gateway/bot
    // source: https://docs.discord.com/developers/events/gateway "is an example of a WSS URL an app may use to connect to the Gateway"
    hosts: [{ host: 'discord.com', pathPattern: '^/(api/|oauth2/)' }, { host: 'discordapp.com', pathPattern: '^/api/' }, { host: 'gateway.discord.gg' }],
    endpointEnvNone: 'the apps call discord.com and send people to its authorize page; the World claims the host, `GET /gateway/bot` answers the twin\'s own socket, and a client that dials the Gateway at gateway.discord.gg reaches the same socket there',
    credentialDoor: { path: '/_twin/app-credentials', body: {}, account: { field: 'account', tenancy: 'Developer user owning the applications', source: 'https://docs.discord.com/developers/topics/oauth2' }, deployment: { field: 'deployment', object: 'Developer application and bot', source: 'https://docs.discord.com/developers/topics/oauth2' }, fill: { DISCORD_CLIENT_ID: 'client_id', DISCORD_CLIENT_SECRET: 'client_secret', DISCORD_BOT_TOKEN: 'bot_token', DISCORD_BOT_TOKEN_ID: 'bot_token', DISCORD_APPLICATION_ID: 'application_id', DISCORD_PUBLIC_KEY: 'public_key' } },
  },
};
