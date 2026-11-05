// What every family of Discord's API shares: its error bodies, the caller (a bot by its token, or a person's OAuth2
// grant), permissions (the documented computation over roles and a channel's overwrites), and the views of its
// objects that embed others (a member its user, a message its author, reactions and thread, an application its owner).
import type { HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export const USER = 'user';
export const APP = 'application';
export const GUILD = 'guild';
export const ROLE = 'role';
export const MEMBER = 'member';
export const CHANNEL = 'channel';
export const MESSAGE = 'message';
export const REACTION = 'reaction';
export const WEBHOOK = 'webhook';
export const INVITE = 'invite';
export const CODE = '_code';
export const ACCESS = '_access_token';
export const REFRESH = '_refresh_token';
export const BOT_TOKEN = '_bot_token';
export const SECRET = '_client_secret';
export const COMMAND = 'command';
export const COMMAND_VERSION = '_command_version';

/** A message flag: the message only the invoking user sees. */
// source: https://docs.discord.com/developers/resources/message "this message is only visible to the user who invoked the Interaction"
export const EPHEMERAL = 64;
/** A boolean query parameter, as Discord reads one. */
// source: https://docs.discord.com/developers/reference "Discord represents such cases using True , true , or 1 for true"
export const queryTrue = (ctx: HandlerContext, name: string): boolean => ['True', 'true', '1'].includes(new URL(ctx.call.request.url).searchParams.get(name) ?? '');

export const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
export const arr = <T = Row>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
export const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v, 'hex');
/** Discord's timestamps: ISO 8601 with microseconds and an offset ("2021-01-23T02:33:17.017000+00:00"). */
export const stamp = (iso: string): string => iso.replace(/(\.\d{3})?Z$/, (_, ms: string | undefined) => `${(ms ?? '.000')}000+00:00`);
const live = (r: Row | undefined): Row | undefined => (r && r.deleted !== true ? r : undefined);
/** A stored row as the vendor's object: its own fields (an `id` or `type` of the vendor's restored, the kernel's left
 *  out), without the twin's bookkeeping (`_`). Every answer and Gateway frame shows a row through it, never raw. */
export const vendorView = (ctx: Pick<HandlerContext, 'own'>, r: Row): Row =>
  Object.fromEntries(Object.entries(ctx.own(r)).filter(([k]) => !k.startsWith('_') && k !== 'deleted'));

// ── errors ─────────────────────────────────────────────────────────────────────────────────────
// source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "Example JSON Error Response"

export const fail = (status: number, code: number, message: string): Response => Response.json({ message, code }, { status });
// source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "The Authorization header was missing or invalid."
export const unauthorized = (): Response => fail(401, 0, '401: Unauthorized');
// source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "Missing access"
export const missingAccess = (): Response => fail(403, 50001, 'Missing Access');
// source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "You lack permissions to perform that action"
export const missingPermissions = (): Response => fail(403, 50013, 'Missing Permissions');
/** "Unknown <thing>" (10003 Unknown channel, 10004 guild, 10007 member, 10008 message, 10011 role, 10013 user, 10014
 *  emoji, 10015 webhook, 10006 invite), as Discord capitalizes it. */
// source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "Unknown channel"
export const unknown = (code: number, thing: string): Response => fail(404, code, `Unknown ${thing}`);
/** What the twin does not serve, answered as Discord answers a route it does not have (the manifest's `gap`). */
export const gap = (): Response => fail(404, 0, '404: Not Found');
/** The form-body error: each field's errors under `errors`, as the reference's Object Error example. */
// source: https://docs.discord.com/developers/reference "Invalid Form Body"
export function invalidForm(errors: Record<string, { code: string; message: string }>): Response {
  const tree: Row = {};
  for (const [path, e] of Object.entries(errors)) {
    let at = tree;
    for (const key of path.split('.')) at = (at[key] ??= {}) as Row;
    at._errors = [e];
  }
  return Response.json({ message: 'Invalid Form Body', code: 50035, errors: tree }, { status: 400 });
}
export const required = { code: 'BASE_TYPE_REQUIRED', message: 'This field is required' };
export const tooLong = (max: number): { code: string; message: string } => ({ code: 'BASE_TYPE_MAX_LENGTH', message: `Must be ${max} or fewer in length.` });
export const lengthBetween = (min: number, max: number): { code: string; message: string } => ({ code: 'BASE_TYPE_BAD_LENGTH', message: `Must be between ${min} and ${max} in length.` });

// ── the caller ─────────────────────────────────────────────────────────────────────────────────
// source: https://docs.discord.com/developers/reference "authentication is performed with the"

export type Caller =
  | { kind: 'bot'; user: Row; app: Row }
  | { kind: 'bearer'; user: Row; app: Row; scopes: string[]; token: Row };

/** The caller a request's Authorization names: a bot by its token, a person by an unexpired OAuth2 token. */
export function callerOf(ctx: HandlerContext): Caller | undefined {
  const header = ctx.call.request.headers.get('authorization') ?? '';
  const bot = /^Bot\s+(\S+)$/i.exec(header)?.[1];
  if (bot) {
    const t = live(ctx.rowsRaw(BOT_TOKEN).find((r) => r.sha256 === sha256(ctx, bot) && r.revoked !== true));
    const app = t ? live(ctx.row(APP, String(t.application))) : undefined;
    const user = app ? live(ctx.row(USER, String(app._bot))) : undefined;
    return app && user ? { kind: 'bot', user, app } : undefined;
  }
  const bearer = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (bearer) {
    const t = live(ctx.rowsRaw(ACCESS).find((r) => r.sha256 === sha256(ctx, bearer) && r.revoked !== true));
    if (!t || Date.parse(String(t.expires)) <= Date.parse(ctx.occurredAt)) return undefined;
    const app = live(ctx.row(APP, String(t.application)));
    const user = live(ctx.row(USER, String(t.user)));
    return app && user ? { kind: 'bearer', user, app, scopes: String(t.scope).split(' ').filter(Boolean), token: t } : undefined;
  }
  return undefined;
}
/** The caller, or the 401 Discord answers. A bearer token's scope that the route needs is `scope`. */
export function authorized(ctx: HandlerContext, scope?: string): Caller | Response {
  const c = callerOf(ctx);
  if (!c) return unauthorized();
  // source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "The Authorization token you passed did not have permission to the resource."
  if (scope && c.kind === 'bearer' && !c.scopes.includes(scope)) return missingAccess();
  return c;
}
/** A route only a bot token reaches (the bot's own guilds, channels and messages): a bearer grant is refused. */
export function botOnly(ctx: HandlerContext): Extract<Caller, { kind: 'bot' }> | Response {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  return c.kind === 'bot' ? c : missingAccess();
}

// ── permissions ────────────────────────────────────────────────────────────────────────────────
// source: https://docs.discord.com/developers/topics/permissions "The following pseudocode demonstrates this process programmatically"

export const P = {
  CREATE_INSTANT_INVITE: 1n << 0n, ADMINISTRATOR: 1n << 3n, MANAGE_CHANNELS: 1n << 4n, MANAGE_GUILD: 1n << 5n, ADD_REACTIONS: 1n << 6n, VIEW_AUDIT_LOG: 1n << 7n,
  VIEW_CHANNEL: 1n << 10n, SEND_MESSAGES: 1n << 11n, SEND_TTS_MESSAGES: 1n << 12n, MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n, ATTACH_FILES: 1n << 15n, READ_MESSAGE_HISTORY: 1n << 16n, MENTION_EVERYONE: 1n << 17n,
  CONNECT: 1n << 20n, CHANGE_NICKNAME: 1n << 26n, MANAGE_ROLES: 1n << 28n, MANAGE_WEBHOOKS: 1n << 29n, CREATE_PUBLIC_THREADS: 1n << 35n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
} as const;
const ALL = (1n << 53n) - 1n;
/** @everyone's permissions in a new server, as the client's "Create My Own" gives them (Discord's default role). */
// Where the documentation stops: the default @everyone permissions of a new server are the client's; the twin gives
// the set a new server shows (view, send, read history, react, embed, attach, invites, nickname, threads, voice).
export const EVERYONE_DEFAULT = (P.CREATE_INSTANT_INVITE | P.ADD_REACTIONS | P.VIEW_CHANNEL | P.SEND_MESSAGES | P.EMBED_LINKS | P.ATTACH_FILES | P.READ_MESSAGE_HISTORY
  | P.CHANGE_NICKNAME | P.CREATE_PUBLIC_THREADS | P.SEND_MESSAGES_IN_THREADS | (1n << 20n) | (1n << 21n) | (1n << 25n) | (1n << 31n)).toString();

export const memberId = (guild: string, user: string): string => `${guild}:${user}`;
export const memberOf = (ctx: Pick<HandlerContext, 'row'>, guild: string, user: string): Row | undefined => live(ctx.row(MEMBER, memberId(guild, user)));
const rolesOf = (ctx: Pick<HandlerContext, 'rowsRaw'>, guild: string): Row[] => ctx.rowsRaw(ROLE).filter((r) => r.deleted !== true && r._guild === guild);

/** A member's permissions in a guild (compute_base_permissions): the owner has all; else @everyone's and its roles'. */
export function basePermissions(ctx: Pick<HandlerContext, 'row' | 'rowsRaw'>, guild: Row, user: string): bigint {
  if (guild.owner_id === user) return ALL;
  const member = memberOf(ctx, String(guild.id), user);
  if (!member) return 0n;
  const roles = rolesOf(ctx, String(guild.id));
  let p = BigInt(String(roles.find((r) => r.id === guild.id)?.permissions ?? '0'));
  for (const id of arr<string>(member.roles)) p |= BigInt(String(roles.find((r) => r.id === id)?.permissions ?? '0'));
  return (p & P.ADMINISTRATOR) === P.ADMINISTRATOR ? ALL : p;
}
/** A member's permissions in a channel (compute_overwrites); a thread takes its parent's overwrites. */
export function channelPermissions(ctx: Pick<HandlerContext, 'row' | 'rowsRaw' | 'own'>, guild: Row, channel: Row, user: string): bigint {
  const base = basePermissions(ctx, guild, user);
  if ((base & P.ADMINISTRATOR) === P.ADMINISTRATOR || base === ALL) return base;
  const source = channel.parent_id && isThread(ctx.own(channel)) ? live(ctx.row(CHANNEL, String(channel.parent_id))) ?? channel : channel;
  const overwrites = arr(source.permission_overwrites);
  const bits = (v: unknown): bigint => BigInt(String(v ?? '0'));
  let p = base;
  const everyone = overwrites.find((o) => o.id === guild.id);
  if (everyone) { p &= ~bits(everyone.deny); p |= bits(everyone.allow); }
  const member = memberOf(ctx, String(guild.id), user);
  let allow = 0n; let deny = 0n;
  for (const id of arr<string>(member?.roles)) { const o = overwrites.find((x) => x.id === id && Number(x.type) === 0); if (o) { allow |= bits(o.allow); deny |= bits(o.deny); } }
  p &= ~deny; p |= allow;
  const own = overwrites.find((o) => o.id === user && Number(o.type) === 1);
  if (own) { p &= ~bits(own.deny); p |= bits(own.allow); }
  // source: https://docs.discord.com/developers/topics/permissions "Denying a user or a role"
  if ((p & P.VIEW_CHANNEL) === 0n) return 0n;
  return p;
}
export const has = (p: bigint, bit: bigint): boolean => (p & bit) === bit;

// ── channels ───────────────────────────────────────────────────────────────────────────────────
// source: https://docs.discord.com/developers/resources/channel "GUILD_TEXT"
export const TYPE = { GUILD_TEXT: 0, DM: 1, GUILD_VOICE: 2, GUILD_CATEGORY: 4, GUILD_ANNOUNCEMENT: 5, ANNOUNCEMENT_THREAD: 10, PUBLIC_THREAD: 11, PRIVATE_THREAD: 12, GUILD_FORUM: 15 } as const;
export const isThread = (c: Row): boolean => [10, 11, 12].includes(Number(c.type));
/** A channel the caller reaches: the channel, its guild and the caller's permissions in it; or the refusal
 *  (10003 when there is none, 50001 when the caller is not in its guild or cannot view it). */
export function channelFor(ctx: HandlerContext, id: string, user: string): { channel: Row; guild: Row; perms: bigint } | Response {
  const channel = live(ctx.row(CHANNEL, id));
  if (!channel) return unknown(10003, 'Channel');
  const guild = live(ctx.row(GUILD, String(channel.guild_id)));
  if (!guild || !memberOf(ctx, String(guild.id), user)) return missingAccess();
  const perms = channelPermissions(ctx, guild, channel, user);
  return has(perms, P.VIEW_CHANNEL) ? { channel: ctx.own(channel), guild, perms } : missingAccess();
}
/** A guild the caller is a member of, or 10004 Unknown Guild (Discord answers the same to a guild the caller is not in). */
export function guildFor(ctx: HandlerContext, id: string, user: string): Row | Response {
  const guild = live(ctx.row(GUILD, id));
  return guild && memberOf(ctx, id, user) ? guild : unknown(10004, 'Guild');
}

// ── views ──────────────────────────────────────────────────────────────────────────────────────
// source: https://docs.discord.com/developers/resources/user "User Structure"

/** A user as another sees it; `me` adds what the user itself sees (email only under the email scope). */
export function userView(u: Row, me?: { email: boolean }): Row {
  const view: Row = {
    id: u.id, username: u.username, avatar: u.avatar ?? null, discriminator: u.discriminator ?? '0', public_flags: u.public_flags ?? 0, flags: u.flags ?? 0,
    ...(u.bot === true ? { bot: true } : {}), ...(u.system === undefined ? {} : { system: u.system }),
    banner: u.banner ?? null, accent_color: u.accent_color ?? null, global_name: u.global_name ?? null,
    avatar_decoration_data: u.avatar_decoration_data ?? null, collectibles: u.collectibles ?? null, primary_guild: u.primary_guild ?? null,
  };
  if (me) Object.assign(view, { mfa_enabled: false, locale: 'en-US', premium_type: 0, ...(me.email ? { email: u.bot === true ? null : u.email ?? null, verified: true } : {}) });
  return view;
}
export const userById = (ctx: Pick<HandlerContext, 'row'>, id: string): Row | undefined => live(ctx.row(USER, id));
/** A member with its user. */
export function memberView(ctx: Pick<HandlerContext, 'row' | 'own'>, m: Row): Row {
  const member = ctx.own(m);
  const u = userById(ctx, String(m._user));
  return {
    avatar: member.avatar, avatar_decoration_data: member.avatar_decoration_data, banner: member.banner,
    communication_disabled_until: member.communication_disabled_until, flags: member.flags, joined_at: member.joined_at,
    nick: member.nick, pending: member.pending, premium_since: member.premium_since, roles: member.roles,
    collectibles: member.collectibles, ...(u ? { user: userView(u) } : {}), mute: member.mute, deaf: member.deaf,
  };
}
/** The native BasicMessageResponse embedded by a full message, without reactions or another referenced message. */
function basicMessageView(ctx: Pick<HandlerContext, 'row' | 'own'>, m: Row): Row {
  const message = ctx.own(m);
  const thread = m.thread_id ? live(ctx.row(CHANNEL, String(m.thread_id))) : undefined;
  // a person's or a bot's message names its author's user as it is now; a webhook's keeps the name it was sent under
  const author = m._author ? userById(ctx, String(m._author)) : undefined;
  return {
    type: message.type, content: message.content,
    mentions: arr<string>(m._mentions).map((id) => userById(ctx, id)).filter(Boolean).map((u) => userView(u!)),
    mention_roles: message.mention_roles, attachments: message.attachments, embeds: message.embeds,
    timestamp: message.timestamp, edited_timestamp: message.edited_timestamp, flags: message.flags, components: message.components,
    stickers: message.stickers, sticker_items: message.sticker_items, id: m.id, channel_id: message.channel_id,
    author: author ? userView(author) : message.author ? userView(obj(message.author)) : undefined,
    pinned: message.pinned, mention_everyone: message.mention_everyone, tts: message.tts,
    call: message.call, activity: message.activity, application: message.application, application_id: message.application_id,
    interaction: message.interaction, nonce: message.nonce, webhook_id: message.webhook_id, message_reference: message.message_reference,
    thread: thread ? vendorView(ctx, thread) : message.thread, mention_channels: message.mention_channels,
    role_subscription_data: message.role_subscription_data, purchase_notification: message.purchase_notification, position: message.position,
    resolved: message.resolved, poll: message.poll, shared_client_theme: message.shared_client_theme,
    interaction_metadata: message.interaction_metadata, message_snapshots: message.message_snapshots, lobby_member: message.lobby_member,
  };
}
/** A native MessageResponse with its author, mentions, reactions, thread and basic referenced message. */
export function messageView(ctx: Pick<HandlerContext, 'row' | 'rowsRaw' | 'own'>, m: Row, viewer?: string): Row {
  const view = basicMessageView(ctx, m);
  const reactions = new Map<string, { emoji: Row; users: string[] }>();
  for (const r of ctx.rowsRaw(REACTION)) if (r.deleted !== true && r._message === m.id) {
    const key = String(r._emoji);
    const at = reactions.get(key) ?? { emoji: obj(r.emoji), users: [] };
    at.users.push(String(r._user));
    reactions.set(key, at);
  }
  // source: https://docs.discord.com/developers/resources/message "Whether the current user reacted using this emoji"
  if (reactions.size) view.reactions = [...reactions.values()].map((r) => ({ count: r.users.length, count_details: { burst: 0, normal: r.users.length }, me: viewer ? r.users.includes(viewer) : false, me_burst: false, burst_colors: [], emoji: r.emoji }));
  const referenced = m.message_reference && obj(m.message_reference).message_id ? live(ctx.row(MESSAGE, String(obj(m.message_reference).message_id))) : undefined;
  if (referenced) view.referenced_message = basicMessageView(ctx, referenced);
  return view;
}
/** The native GuildRoleResponse, including its own color and tag classes. */
export function roleView(ctx: Pick<HandlerContext, 'own'>, r: Row): Row {
  const role = ctx.own(r), colors = obj(role.colors), tags = obj(role.tags);
  return {
    id: r.id, name: role.name, permissions: role.permissions, position: role.position, color: role.color,
    colors: { primary_color: colors.primary_color, secondary_color: colors.secondary_color, tertiary_color: colors.tertiary_color },
    hoist: role.hoist, managed: role.managed, mentionable: role.mentionable, icon: role.icon, unicode_emoji: role.unicode_emoji,
    ...(role.tags === undefined ? {} : { tags: {
      premium_subscriber: tags.premium_subscriber, bot_id: tags.bot_id, integration_id: tags.integration_id,
      subscription_listing_id: tags.subscription_listing_id, available_for_purchase: tags.available_for_purchase, guild_connections: tags.guild_connections,
    } }), flags: role.flags,
  };
}

/** The native GuildResponse used by the token answer and the Gateway's guild event. */
export function guildView(ctx: Pick<HandlerContext, 'own' | 'rowsRaw'>, g: Row): Row {
  const guild = ctx.own(g);
  return {
    id: g.id, name: guild.name, icon: guild.icon, description: guild.description, home_header: guild.home_header ?? null,
    splash: guild.splash, discovery_splash: guild.discovery_splash, features: guild.features, banner: guild.banner,
    owner_id: guild.owner_id, application_id: guild.application_id, region: guild.region, afk_channel_id: guild.afk_channel_id,
    afk_timeout: guild.afk_timeout, system_channel_id: guild.system_channel_id, system_channel_flags: guild.system_channel_flags,
    widget_enabled: guild.widget_enabled, widget_channel_id: guild.widget_channel_id, verification_level: guild.verification_level,
    roles: ctx.rowsRaw(ROLE).filter((r) => r.deleted !== true && r._guild === g.id).map((r) => roleView(ctx, r)),
    default_message_notifications: guild.default_message_notifications, mfa_level: guild.mfa_level, explicit_content_filter: guild.explicit_content_filter,
    max_presences: guild.max_presences, max_members: guild.max_members, max_stage_video_channel_users: guild.max_stage_video_channel_users,
    max_video_channel_users: guild.max_video_channel_users, vanity_url_code: guild.vanity_url_code, premium_tier: guild.premium_tier,
    premium_subscription_count: guild.premium_subscription_count, preferred_locale: guild.preferred_locale, rules_channel_id: guild.rules_channel_id,
    safety_alerts_channel_id: guild.safety_alerts_channel_id, public_updates_channel_id: guild.public_updates_channel_id,
    premium_progress_bar_enabled: guild.premium_progress_bar_enabled, premium_progress_bar_enabled_user_updated_at: guild.premium_progress_bar_enabled_user_updated_at,
    nsfw: guild.nsfw, nsfw_level: guild.nsfw_level, emojis: guild.emojis, stickers: guild.stickers, incidents_data: guild.incidents_data,
  };
}

// ── applications ───────────────────────────────────────────────────────────────────────────────
// source: https://docs.discord.com/developers/resources/application "Application Structure"

/** An application's public key, as the portal shows it: its Ed25519 public key in hex. */
export async function verifyKey(ctx: Pick<HandlerContext, 'signingKey'>, app: string): Promise<string> {
  const { publicPem } = await ctx.signingKey(`discord-application:${app}`, 'Ed25519');
  const der = Buffer.from(publicPem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
  return der.subarray(der.length - 32).toString('hex');
}
/** The native application's optional OAuth2 installation parameters. */
function appInstallParams(value: unknown): Row | undefined {
  if (value === undefined || value === null) return undefined;
  const params = obj(value);
  return { scopes: params.scopes, permissions: params.permissions };
}

/** The public ApplicationResponse embedded by the current authorization. */
export function publicAppView(ctx: Pick<HandlerContext, 'row' | 'own'>, a: Row): Row {
  const application = ctx.own(a);
  const bot = userById(ctx, String(a._bot));
  return {
    id: a.id, name: application.name, icon: application.icon, description: application.description, type: application.type,
    cover_image: application.cover_image, primary_sku_id: application.primary_sku_id, flags: application.flags, flags_new: application.flags_new,
    ...(bot ? { bot: userView(bot) } : {}), slug: application.slug, vibegrations_project_id: application.vibegrations_project_id,
    guild_id: application.guild_id, rpc_origins: application.rpc_origins, bot_public: application.bot_public, bot_require_code_grant: application.bot_require_code_grant,
    terms_of_service_url: application.terms_of_service_url, privacy_policy_url: application.privacy_policy_url, custom_install_url: application.custom_install_url,
    install_params: appInstallParams(application.install_params),
    integration_types_config: application.integration_types_config === undefined ? undefined : Object.fromEntries(Object.entries(obj(application.integration_types_config))
      .map(([kind, config]) => [kind, { oauth2_install_params: appInstallParams(obj(config).oauth2_install_params) }])),
    verify_key: application.verify_key, max_participants: application.max_participants, tags: application.tags,
  };
}

/** The native PrivateApplicationResponse returned by the bot's own application reads. */
// source: https://docs.discord.com/developers/resources/application "Partial user object for the owner of the app"
export function appView(ctx: Pick<HandlerContext, 'row' | 'rowsRaw' | 'own'>, a: Row): Row {
  const application = ctx.own(a);
  const owner = a._owner ? userById(ctx, String(a._owner)) : undefined;
  // source: https://docs.discord.com/developers/resources/application "Approximate count of guilds the app has been added to"
  const approximate_guild_count = ctx.rowsRaw(MEMBER).filter((m) => m.deleted !== true && m._user === a._bot && live(ctx.row(GUILD, String(m._guild)))).length;
  return {
    ...publicAppView(ctx, a), redirect_uris: application.redirect_uris, interactions_endpoint_url: application.interactions_endpoint_url,
    role_connections_verification_url: application.role_connections_verification_url, owner: owner ? userView(owner) : application.owner,
    approximate_guild_count, approximate_user_install_count: application.approximate_user_install_count,
    approximate_user_authorization_count: application.approximate_user_authorization_count, event_webhooks_url: application.event_webhooks_url,
    event_webhooks_status: application.event_webhooks_status, event_webhooks_types: application.event_webhooks_types,
    explicit_content_filter: application.explicit_content_filter, team: application.team, eligible_oauth2_scopes: application.eligible_oauth2_scopes,
  };
}

export const IDENTIFY = '_identify';

/** Discord's Gateway is a separate host from its REST API. A direct twin listener retains its local socket. */
// source: https://docs.discord.com/developers/events/gateway "is an example of a WSS URL an app may use to connect to the Gateway"
// The page's Get Gateway Bot Example Response, recorded in spec/doc-examples.json, names gateway.discord.gg.
export const gatewayUrl = (ctx: Pick<HandlerContext, 'publicBase'>): string => {
  const base = new URL(ctx.publicBase);
  if (base.hostname === 'discord.com' || base.hostname === 'discordapp.com') return 'wss://gateway.discord.gg/';
  return `${ctx.publicBase.replace(/^http/, 'ws').replace(/\/+$/, '')}/`;
};

/** A token-shaped value (Discord's are 30 letters and digits), drawn from the World's secret under its label. */
export const tokenValue = async (ctx: Pick<HandlerContext, 'secret'>, label: string): Promise<string> =>
  `${await ctx.secret(label)}${await ctx.secret(`${label}:2`)}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 30);

/** Whether an invite still admits: unexpired, under its uses. */
export function inviteOpen(ctx: HandlerContext, i: Row | undefined): i is Row {
  if (!i || i.deleted === true) return false;
  const expired = i.expires_at !== null && Date.parse(String(i.expires_at)) <= Date.parse(ctx.occurredAt);
  const used = Number(i.max_uses) > 0 && ctx.rowsRaw(MEMBER).filter((m) => m._invite === i.id).length >= Number(i.max_uses);
  return !expired && !used;
}

// ── what several families make ─────────────────────────────────────────────────────────────────

// source: https://docs.discord.com/developers/resources/guild "Guild Structure"
/** A server as a person makes it in the client ("Create My Own"): @everyone, a Text Channels category with #general
 *  (its system channel) and a Voice Channels category with General; the owner its first member. */
export async function makeGuild(ctx: HandlerContext, owner: Row, name: string): Promise<Row> {
  const id = ctx.mint(GUILD);
  const text = ctx.mint(CHANNEL);
  await ctx.write(GUILD, id, {
    id, name, icon: null, home_header: null, splash: null, discovery_splash: null, owner_id: owner.id, afk_channel_id: null, afk_timeout: 300,
    widget_enabled: false, widget_channel_id: null, verification_level: 0, default_message_notifications: 0, explicit_content_filter: 0, emojis: [], stickers: [],
    features: [], mfa_level: 0, application_id: null, system_channel_id: null, system_channel_flags: 0, rules_channel_id: null, max_presences: null, max_members: 500000,
    vanity_url_code: null, description: null, banner: null, premium_tier: 0, premium_subscription_count: 0, preferred_locale: 'en-US', public_updates_channel_id: null,
    max_video_channel_users: 25, max_stage_video_channel_users: 50, nsfw_level: 0, safety_alerts_channel_id: null, premium_progress_bar_enabled: false,
    region: 'deprecated', nsfw: false, incidents_data: null,
  }, 'guild.create');
  // source: https://docs.discord.com/developers/topics/permissions "The @everyone role has the same ID as the guild it belongs to."
  await ctx.write(ROLE, id, { id, name: '@everyone', color: 0, colors: { primary_color: 0, secondary_color: null, tertiary_color: null }, hoist: false, icon: null, unicode_emoji: null, position: 0, permissions: EVERYONE_DEFAULT, managed: false, mentionable: false, flags: 0, _guild: id }, 'role.create');
  await join(ctx, id, String(owner.id));
  const category = async (label: string, position: number): Promise<string> => makeChannel(ctx, id, { name: label, type: TYPE.GUILD_CATEGORY, position });
  const textCategory = await category('Text Channels', 0);
  const voiceCategory = await category('Voice Channels', 1);
  await makeChannel(ctx, id, { name: 'general', type: TYPE.GUILD_TEXT, position: 0, parent_id: textCategory }, text);
  await makeChannel(ctx, id, { name: 'General', type: TYPE.GUILD_VOICE, position: 0, parent_id: voiceCategory });
  await ctx.write(GUILD, id, { system_channel_id: text }, 'guild.update');
  return ctx.row(GUILD, id)!;
}

/** A user joins a server: a member with no roles yet. */
export async function join(ctx: HandlerContext, guild: string, user: string, fields: Row = {}): Promise<Row> {
  const id = memberId(guild, user);
  await ctx.write(MEMBER, id, { avatar: null, banner: null, communication_disabled_until: null, flags: 0, joined_at: stamp(ctx.occurredAt), nick: null, pending: false, premium_since: null, roles: [], mute: false, deaf: false, _guild: guild, _user: user, ...fields }, 'member.add');
  return ctx.row(MEMBER, id)!;
}

/** A channel as Discord stores a guild channel. */
export async function makeChannel(ctx: HandlerContext, guild: string, b: Row, given?: string): Promise<string> {
  const id = given ?? ctx.mint(CHANNEL);
  const type = Number(b.type ?? TYPE.GUILD_TEXT);
  const voice = type === TYPE.GUILD_VOICE;
  await ctx.write(CHANNEL, id, {
    id, type, guild_id: guild, name: b.name, position: Number(b.position ?? 0), parent_id: b.parent_id ?? null, flags: 0,
    permission_overwrites: arr(b.permission_overwrites).map((o) => ({ id: String(o.id), type: Number(o.type ?? 0), allow: String(o.allow ?? '0'), deny: String(o.deny ?? '0') })),
    ...(type === TYPE.GUILD_CATEGORY ? {} : { nsfw: b.nsfw === true, rate_limit_per_user: Number(b.rate_limit_per_user ?? 0) }),
    ...(type === TYPE.GUILD_TEXT || type === TYPE.GUILD_ANNOUNCEMENT ? { topic: b.topic ?? null, last_message_id: null, default_thread_rate_limit_per_user: 0 } : {}),
    ...(voice ? { bitrate: Number(b.bitrate ?? 64000), user_limit: Number(b.user_limit ?? 0), rtc_region: b.rtc_region ?? null, last_message_id: null } : {}),
  }, 'channel.create');
  return id;
}

/** A role as Discord makes it (a bot's managed role too): at the bottom, just above @everyone, the others moved up. */
// Where the documentation stops: Discord places a new role at position 1 (the client shows it last); the twin does so
export async function makeRole(ctx: HandlerContext, guild: string, b: Row, extra: Row = {}): Promise<Row> {
  const id = ctx.mint(ROLE);
  for (const r of ctx.rowsRaw(ROLE).filter((x) => x.deleted !== true && x._guild === guild && x.id !== guild)) await ctx.write(ROLE, String(r.id), { position: Number(r.position) + 1 }, 'role.update');
  const position = 1;
  const color = Number(b.color ?? obj(b.colors).primary_color ?? 0);
  await ctx.write(ROLE, id, {
    id, name: String(b.name ?? 'new role'), color, colors: { primary_color: color, secondary_color: null, tertiary_color: null }, hoist: b.hoist === true, icon: null,
    unicode_emoji: b.unicode_emoji ?? null, position, permissions: String(b.permissions ?? ctx.row(ROLE, guild)?.permissions ?? '0'), managed: false, mentionable: b.mentionable === true, flags: 0,
    _guild: guild, ...extra,
  }, 'role.create');
  return ctx.row(ROLE, id)!;
}

const MB = 1024 * 1024;

/** A request's message body: JSON, or multipart's `payload_json` (or its fields) with its `files[n]`. */
export async function messageBody(ctx: HandlerContext): Promise<{ body: Row; files: Array<{ index: number; name: string; type: string; bytes: number; data: Uint8Array }> }> {
  const type = ctx.call.request.headers.get('content-type') ?? '';
  if (!type.startsWith('multipart/form-data')) return { body: obj(ctx.body), files: [] };
  const form = await ctx.call.request.clone().formData();
  const body: Row = typeof form.get('payload_json') === 'string' ? obj(JSON.parse(String(form.get('payload_json')))) : {};
  const files: Array<{ index: number; name: string; type: string; bytes: number; data: Uint8Array }> = [];
  for (const [key, value] of form.entries()) {
    const index = /^files\[(\d+)\]$/.exec(key)?.[1];
    // a part with a filename is a File (the Fetch standard's FormDataEntryValue), whatever the runtime's types narrow it to
    const file = typeof value === 'string' ? undefined : (value as unknown as File);
    if (index !== undefined && file) files.push({ index: Number(index), name: file.name, type: file.type, bytes: file.size, data: new Uint8Array(await file.arrayBuffer()) });
    else if (key !== 'payload_json' && typeof value === 'string' && !(key in body)) body[key] = value;
  }
  // a form field is text: `tts` sent as its own field is the boolean it spells, as the page's example sends it
  // source: https://docs.discord.com/developers/reference "This example demonstrates usage of the endpoint without payload_json"
  if (typeof body.tts === 'string') body.tts = body.tts === 'true';
  return { body, files };
}

/** The user ids, role ids and @everyone a message's content mentions, as its allowed_mentions lets them ping. */
function mentionsOf(content: string, allowed: Row | undefined): { users: string[]; roles: string[]; everyone: boolean } {
  const users = [...content.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]!);
  const roles = [...content.matchAll(/<@&(\d+)>/g)].map((m) => m[1]!);
  const everyone = /@(everyone|here)\b/.test(content);
  // source: https://docs.discord.com/developers/resources/message "Allowed Mentions Object"
  if (!allowed) return { users: [...new Set(users)], roles: [...new Set(roles)], everyone };
  const parse = arr<string>(allowed.parse);
  const pick = (found: string[], kind: string, listed: unknown): string[] => [...new Set(parse.includes(kind) ? found : found.filter((id) => arr<string>(listed).includes(id)))];
  return { users: pick(users, 'users', allowed.users), roles: pick(roles, 'roles', allowed.roles), everyone: everyone && parse.includes('everyone') };
}

/** Who sends a message: a person or a bot (its user), or a webhook. */
export type Sender = { user?: string; webhook?: Row; application?: string; interaction?: Row; original?: boolean };

/** A message as Discord makes it: its content checked, its attachments named, its mentions resolved; the channel's
 *  last_message_id moves to it. The caller has checked who may send it. */
export async function newMessage(ctx: HandlerContext, channel: Row, from: Sender, body: Row, files: Array<{ index: number; name: string; type: string; bytes: number; data: Uint8Array }> = []): Promise<Row | Response> {
  const content = typeof body.content === 'string' ? body.content : '';
  // source: https://docs.discord.com/developers/resources/message "Message contents (up to 2000 characters)"
  if (content.length > 2000) return invalidForm({ content: tooLong(2000) });
  const embeds = arr(body.embeds);
  // source: https://docs.discord.com/developers/resources/message "Up to 10"
  if (embeds.length > 10) return invalidForm({ embeds: { code: 'BASE_TYPE_MAX_LENGTH', message: 'Must be 10 or fewer in length.' } });
  const components = arr(body.components);
  // source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "Cannot send an empty message"
  if (!content && !embeds.length && !components.length && !files.length && !arr(body.sticker_ids).length && !body.poll && !(from.interaction && (Number(body.flags) & 128))) return fail(400, 50006, 'Cannot send an empty message');
  // source: https://docs.discord.com/developers/reference "The default limit is"
  if (files.some((f) => f.bytes > 20 * MB)) return fail(413, 40005, 'Request entity too large');
  // source: https://docs.discord.com/developers/resources/message "despite those fields being mutually exclusive, causing a validation error"
  // source: https://docs.discord.com/developers/resources/message "In interactions and webhooks, only user mentions are parsed"
  const allowed = body.allowed_mentions === undefined ? (from.webhook || from.interaction ? { parse: ['users'] } : undefined) : obj(body.allowed_mentions);
  // Where the documentation stops: the validation error's field code and message are the twin's, in the form-body error
  const exclusive = (['users', 'roles'] as const).find((kind) => arr<string>(allowed?.parse).includes(kind) && arr(allowed?.[kind]).length > 0);
  if (exclusive) return invalidForm({ [`allowed_mentions.${exclusive}`]: { code: 'MESSAGE_ALLOWED_MENTIONS_PARSE_EXCLUSIVE', message: `parse:["${exclusive}"] and ${exclusive}: [ids...] are mutually exclusive.` } });
  const reference = obj(body.message_reference);
  if (reference.message_id !== undefined) {
    const target = ctx.row(MESSAGE, String(reference.message_id));
    // source: https://docs.discord.com/developers/resources/message "The referenced message must exist and cannot be a system message."
    if (!target || target.deleted === true) return invalidForm({ 'message_reference': { code: 'MESSAGE_REFERENCE_UNKNOWN_MESSAGE', message: 'Unknown message' } });
  }
  const id = ctx.mint(MESSAGE);
  const attachments = await uploadedAttachments(ctx, id, String(channel.id), body, files);
  const mentions = mentionsOf(content, allowed);
  const reply = reference.message_id !== undefined;
  const fields: Row = {
    id, channel_id: channel.id, content, timestamp: stamp(ctx.occurredAt), edited_timestamp: null, tts: body.tts === true,
    mention_everyone: mentions.everyone, mention_roles: mentions.roles, attachments, embeds: embeds.map((e) => ({ ...e, type: 'rich' })), pinned: false,
    // source: https://docs.discord.com/developers/resources/message "REPLY"
    type: from.interaction && from.original && Number(ctx.own(from.interaction).type) === 2 ? 20 : reply ? 19 : 0, flags: Number(body.flags ?? 0), components,
    ...(reply ? { message_reference: { type: 0, message_id: String(reference.message_id), channel_id: String(reference.channel_id ?? channel.id), ...(channel.guild_id ? { guild_id: channel.guild_id } : {}) } } : {}),
    ...(from.webhook ? { webhook_id: from.webhook.id, author: { id: from.webhook.id, username: String(body.username ?? from.webhook.name), avatar: from.webhook.avatar ?? null, discriminator: '0000', bot: true } } : {}),
    ...(from.application ? { application_id: from.application } : {}),
    // source: https://docs.discord.com/developers/resources/message "if the message is an Interaction or application-owned webhook"
    ...(from.interaction ? { webhook_id: from.application, _interaction: from.interaction.id,
      interaction_metadata: { id: from.interaction.id, type: Number(ctx.own(from.interaction).type), user: userView(userById(ctx, String(from.interaction._user))!),
        authorizing_integration_owners: { '0': from.interaction.guild_id },
        // source: https://docs.discord.com/developers/resources/message "ID of the message that contained the interactive component"
        ...(Number(ctx.own(from.interaction).type) === 3 ? { interacted_message_id: from.interaction._source_message } : {}),
        // source: https://docs.discord.com/developers/resources/message "present only on follow-up messages"
        ...(!from.original && from.interaction._original ? { original_response_message_id: from.interaction._original } : {}) } } : {}),
    ...(from.user ? { _author: from.user } : {}),
    _mentions: mentions.users, ...(channel.guild_id ? { _guild: channel.guild_id } : {}),
  };
  await ctx.write(MESSAGE, id, fields, 'message.create');
  // source: https://docs.discord.com/developers/resources/message "this message is only visible to the user who invoked the Interaction"
  if (!(Number(fields.flags) & EPHEMERAL)) await ctx.write(CHANNEL, String(channel.id), { last_message_id: id }, 'channel.last_message');
  return ctx.row(MESSAGE, id)!;
}

/** An edit of a message's content, embeds, components or flags (its mentions made again from new content). */
// source: https://docs.discord.com/developers/resources/message "will be reconstructed from scratch based on the new content"
export async function editMessage(ctx: HandlerContext, message: Row, body: Row, viewer?: string, files: Upload[] = []): Promise<Response> {
  const fields: Row = { edited_timestamp: stamp(ctx.occurredAt) };
  if (body.content !== undefined) {
    const content = body.content === null ? '' : String(body.content);
    // source: https://docs.discord.com/developers/resources/message "Message contents (up to 2000 characters)"
    if (content.length > 2000) return invalidForm({ content: tooLong(2000) });
    const mentions = mentionsOf(content, body.allowed_mentions === undefined ? (message.webhook_id ? { parse: ['users'] } : undefined) : obj(body.allowed_mentions));
    Object.assign(fields, { content, _mentions: mentions.users, mention_roles: mentions.roles, mention_everyone: mentions.everyone });
  }
  // source: https://docs.discord.com/developers/resources/message "the attachments array must contain all attachments that should be present after edit"
  if (body.attachments !== undefined || files.length) {
    const kept = body.attachments === undefined ? arr(message.attachments) : arr(message.attachments)
      .filter((a) => arr(body.attachments).some((meta) => String(meta.id) === String(a.id)))
      .map((a) => ({ ...a, ...obj(arr(body.attachments).find((meta) => String(meta.id) === String(a.id))) }));
    fields.attachments = [...kept, ...await uploadedAttachments(ctx, String(message.id), String(message.channel_id), body, files)];
  }
  if (body.embeds !== undefined) fields.embeds = arr(body.embeds).map((e) => ({ ...e, type: 'rich' }));
  if (body.components !== undefined) fields.components = arr(body.components);
  // source: https://docs.discord.com/developers/resources/message "unsupported flag changes are currently ignored without error"
  if (body.flags !== undefined) fields.flags = (Number(message.flags ?? 0) & ~4) | (Number(body.flags) & 32772);
  await ctx.write(MESSAGE, String(message.id), fields, 'message.update');
  return Response.json(messageView(ctx, ctx.row(MESSAGE, String(message.id))!, viewer));
}

/** A user reacts to a message they can read (a bot through the API, a person in the client): ADD_REACTIONS unless
 *  someone already reacted with the emoji; a reaction already made is made again with nothing changed. One subject per
 *  message, emoji and user (`{message}:{emoji}:{user}`). */
export async function addReaction(ctx: HandlerContext, at: { channel: Row; perms: bigint; message: Row }, emoji: string, user: string): Promise<Response | undefined> {
  const others = ctx.rowsRaw(REACTION).some((r) => r.deleted !== true && r._message === at.message.id && r._emoji === emoji);
  // source: https://docs.discord.com/developers/resources/message "if nobody else has reacted to the message using this emoji"
  if (!others && !has(at.perms, P.ADD_REACTIONS)) return missingPermissions();
  const id = `${String(at.message.id)}:${emoji}:${user}`;
  if (live(ctx.row(REACTION, id))) return undefined;
  // a reaction taken back and made again is the same subject, live again
  await ctx.write(REACTION, id, { emoji: { id: null, name: emoji }, _message: at.message.id, _emoji: emoji, _user: user, _channel: at.channel.id, _guild: at.channel.guild_id, deleted: false }, 'reaction.add');
  return undefined;
}

// ── webhooks and invites ───────────────────────────────────────────────────────────────────────

/** A webhook's token: 68 letters, digits, `-` and `_`, drawn from the World's secret. */
export const webhookToken = async (ctx: Pick<HandlerContext, 'secret'>, id: string): Promise<string> =>
  `${await ctx.secret(`discord-webhook:${id}`)}${await ctx.secret(`discord-webhook:${id}:2`)}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 68);

/** A webhook as a reader holding MANAGE_WEBHOOKS sees it: with its creator and, an incoming webhook, its token. */
// source: https://docs.discord.com/developers/resources/webhook "the secure token of the webhook (returned for Incoming Webhooks)"
export async function webhookView(ctx: HandlerContext, h: Row): Promise<Row> {
  const creator = userById(ctx, String(h._creator));
  return { ...vendorView(ctx, h), ...(creator ? { user: userView(creator) } : {}), ...(Number(ctx.own(h).type) === 1 ? { token: await webhookToken(ctx, String(h.id)) } : {}) };
}

/** An invite as its creation answers it: its guild and channel partial, its uses counted from the members who joined
 *  through it; without `metadata` (a reader without MANAGE_GUILD) its uses, limits and creation left out. */
export function inviteView(ctx: HandlerContext, i: Row, metadata = true): Row {
  const guild = ctx.row(GUILD, String(i._guild));
  const channel = ctx.row(CHANNEL, String(i._channel));
  const inviter = userById(ctx, String(i._inviter));
  const { id: _id, ...view } = vendorView(ctx, i);
  const full: Row = {
    ...view, code: i.id,
    guild: guild ? { id: guild.id, name: guild.name, splash: guild.splash, banner: guild.banner, description: guild.description, icon: guild.icon, features: guild.features, verification_level: guild.verification_level, vanity_url_code: guild.vanity_url_code, nsfw_level: guild.nsfw_level, nsfw: guild.nsfw, premium_subscription_count: guild.premium_subscription_count } : null,
    guild_id: i._guild, channel: channel ? { id: channel.id, type: ctx.own(channel).type, name: channel.name } : null, ...(inviter ? { inviter: userView(inviter) } : {}),
    uses: ctx.rowsRaw(MEMBER).filter((m) => m._invite === i.id).length,
  };
  if (metadata) return full;
  const { uses: _u, max_uses: _m, max_age: _a, temporary: _t, created_at: _c, ...plain } = full;
  return plain;
}


// ── application commands ───────────────────────────────────────────────────────────────────────
// source: https://docs.discord.com/developers/interactions/application-commands "Application Command Structure"

/** The application a command route names, when it is the caller's own (a bot's application, or the application a
 *  bearer grant holding applications.commands.update was issued to); else Missing Access. */
// Where the documentation stops: the pages do not say what another application's commands answer; the twin answers
// Discord's error for a resource the token has no access to
// source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "Missing access"
export function commandApp(ctx: HandlerContext): Row | Response {
  const c = authorized(ctx, 'applications.commands.update');
  if (c instanceof Response) return c;
  return String(ctx.call.params.application_id) === String(c.app.id) ? c.app : missingAccess();
}
/** An application's live global commands. */
export const commandsOf = (ctx: Pick<HandlerContext, 'rowsRaw'>, app: string): Row[] =>
  ctx.rowsRaw(COMMAND).filter((r) => r.deleted !== true && r.application_id === app).sort((a, z) => (BigInt(String(a.id)) < BigInt(String(z.id)) ? -1 : 1));
/** A command as the API answers it; a list leaves the localization dictionaries out unless asked for them. */
// source: https://docs.discord.com/developers/interactions/application-commands "Whether to include full localization dictionaries"
export function commandView(ctx: Pick<HandlerContext, 'own'>, r: Row, localizations = true): Row {
  const view = vendorView(ctx, r);
  if (!localizations) { delete view.name_localizations; delete view.description_localizations; }
  return view;
}
/** A command's next version: a new snowflake on each change, recorded so no later id repeats it. */
// source: https://docs.discord.com/developers/interactions/application-commands "Autoincrementing version identifier updated during substantial record changes"
export async function commandVersion(ctx: HandlerContext, command: string): Promise<string> {
  const v = ctx.mint(COMMAND_VERSION);
  await ctx.record(COMMAND_VERSION, { command }, v);
  return v;
}

// source: https://docs.discord.com/developers/interactions/application-commands "CHAT_INPUT command names and command option names must match the following regex"
const COMMAND_NAME = /^[-_ʼ\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;
// source: https://docs.discord.com/developers/interactions/application-commands "If there is a lowercase variant of any letters used, you must use those."
const validName = (v: unknown): boolean => typeof v === 'string' && COMMAND_NAME.test(v) && v.toLowerCase() === v;
// source: https://docs.discord.com/developers/interactions/application-commands "1-100 character description"
const validDescription = (v: unknown): boolean => typeof v === 'string' && v.length >= 1 && v.length <= 100;
// Where the documentation stops: the pages state the rules, not the error each draws; the twin answers each in the
// form-body error (50035), with the codes Discord's answers name for them
const badName = { code: 'APPLICATION_COMMAND_INVALID_NAME', message: 'Command name is invalid' };

/** A slash command's fields checked as the page states them: its name and description, at most 25 options, each
 *  named and described the same way with at most 25 choices, the required ones first. `partial` checks only the
 *  fields given (an edit). The refusal, or undefined. */
export function commandInvalid(b: Row, partial: boolean): Response | undefined {
  if ((!partial || b.name !== undefined) && !validName(b.name)) return invalidForm({ name: badName });
  // source: https://docs.discord.com/developers/interactions/application-commands "Description for CHAT_INPUT and PRIMARY_ENTRY_POINT commands, 1-100 characters."
  if ((!partial || b.description !== undefined) && !validDescription(b.description)) return invalidForm({ description: lengthBetween(1, 100) });
  const options = arr(b.options);
  // source: https://docs.discord.com/developers/interactions/application-commands "Parameters for the command, max of 25"
  if (options.length > 25) return invalidForm({ options: tooLong(25) });
  for (const [i, o] of options.entries()) {
    if (!validName(o.name)) return invalidForm({ [`options.${i}.name`]: badName });
    if (!validDescription(o.description)) return invalidForm({ [`options.${i}.description`]: lengthBetween(1, 100) });
    // source: https://docs.discord.com/developers/interactions/application-commands "Choices for the user to pick from, max 25"
    if (arr(o.choices).length > 25) return invalidForm({ [`options.${i}.choices`]: tooLong(25) });
  }
  // source: https://docs.discord.com/developers/interactions/application-commands "Required options must be listed before optional options"
  if (options.some((o, i) => o.required === true && options.slice(0, i).some((p) => p.required !== true))) return invalidForm({ options: { code: 'APPLICATION_COMMAND_OPTIONS_REQUIRED_INVALID', message: 'Required options must be placed before non-required options' } });
  return undefined;
}

/** The fields a create or an edit sets, as Discord stores them (permissions a string, no options an empty list, a null
 *  `dm_permission` or `integration_types` its default, the rest as sent). */
// source: https://docs.discord.com/developers/interactions/application-commands "Set of permissions represented as a bit set"
export function commandFields(b: Row, app: Row): Row {
  const out: Row = {};
  for (const k of ['name', 'name_localizations', 'description', 'description_localizations', 'options', 'dm_permission', 'contexts', 'integration_types', 'nsfw'] as const) if (b[k] !== undefined) out[k] = b[k];
  if (b.options === null) out.options = [];
  // source: https://docs.discord.com/developers/interactions/application-commands "By default, commands are visible."
  if (b.dm_permission === null) out.dm_permission = true;
  // source: https://docs.discord.com/developers/interactions/application-commands "Installation contexts where the command is available, only for globally-scoped commands. Defaults to your app"
  if (b.integration_types === null) out.integration_types = Object.keys(obj(app.integration_types_config)).map(Number);
  if (b.default_member_permissions !== undefined) out.default_member_permissions = b.default_member_permissions === null ? null : String(b.default_member_permissions);
  return out;
}

// ── interactions ──────────────────────────────────────────────────────────────────────────────
export const INTERACTION = '_interaction';
export type Upload = { index: number; name: string; type: string; bytes: number; data: Uint8Array };
export const interactionToken = (ctx: Pick<HandlerContext, 'secret'>, id: string): Promise<string> => tokenValue(ctx, `discord-interaction:${id}`);

/** A delivered interaction, authenticated by its token and scoped to its id or application. */
// source: https://docs.discord.com/developers/interactions/receiving-and-responding "Interaction tokens are valid for 15 minutes"
export function interactionAt(ctx: HandlerContext, callback = false): Row | Response {
  const value = String(ctx.call.params.interaction_token ?? ctx.call.params.webhook_token);
  const hash = sha256(ctx, value);
  const i = ctx.rowsRaw(INTERACTION).find((r) => r._token_sha256 === hash && (callback
    ? r.id === ctx.call.params.interaction_id : r.application_id === ctx.call.params.webhook_id));
  const age = i ? Date.parse(ctx.occurredAt) - Date.parse(String(i._delivered_at)) : Infinity;
  // source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "Unknown interaction"
  if (!i || age >= 900_000 || (i._state === 'pending' && age >= 3_000)) return callback ? unknown(10062, 'interaction') : unknown(10015, 'Webhook');
  return i;
}

/** The payload sent to the application; token custody remains in the World. */
// source: https://docs.discord.com/developers/interactions/receiving-and-responding "Interaction Structure"
export async function interactionView(ctx: HandlerContext, i: Row): Promise<Row> {
  const app = ctx.row(APP, String(i.application_id))!;
  const guild = ctx.row(GUILD, String(i.guild_id))!;
  const channel = ctx.row(CHANNEL, String(i.channel_id))!;
  const member = memberOf(ctx, String(i.guild_id), String(i._user))!;
  const { user, ...membership } = memberView(ctx, member);
  const source = i._source_message ? ctx.row(MESSAGE, String(i._source_message)) : undefined;
  return {
    id: i.id, application_id: i.application_id, type: ctx.own(i).type, data: i.data,
    guild_id: i.guild_id, channel_id: i.channel_id, channel: vendorView(ctx, channel),
    member: { ...membership, user, permissions: channelPermissions(ctx, guild, channel, String(i._user)).toString() },
    token: await interactionToken(ctx, String(i.id)), version: 1, locale: 'en-US', guild_locale: 'en-US',
    app_permissions: channelPermissions(ctx, guild, channel, String(app._bot)).toString(),
    authorizing_integration_owners: { '0': i.guild_id }, context: 0, attachment_size_limit: 20 * 1024 * 1024,
    ...(source ? { message: messageView(ctx, source, String(app._bot)) } : {}),
  };
}

/** The original response must belong to this token, or to this incoming webhook. */
// source: https://docs.discord.com/developers/interactions/receiving-and-responding "Edits the initial Interaction response."
export function webhookMessage(ctx: HandlerContext, owner: Row, interaction: boolean): Row | Response {
  const m = owner._original ? ctx.row(MESSAGE, String(owner._original)) : undefined;
  if (!m || m.deleted === true || (interaction ? m._interaction !== owner.id && m.id !== owner._source_message : m.webhook_id !== owner.id)) return unknown(10008, 'Message');
  return m;
}

/** A webhook route can carry either an incoming webhook's token or an interaction's token. */
// source: https://docs.discord.com/developers/interactions/receiving-and-responding "Interactions webhooks share the same rate limit properties as normal webhooks."
export function webhookOwner(ctx: HandlerContext): { owner: Row; interaction: boolean } | Response {
  const hook = ctx.row(WEBHOOK, String(ctx.call.params.webhook_id));
  if (hook && hook.deleted !== true) return hook._token_sha256 === sha256(ctx, String(ctx.call.params.webhook_token))
    ? { owner: hook, interaction: false } : fail(401, 50027, 'Invalid Webhook Token');
  const i = interactionAt(ctx);
  if (i instanceof Response) return i;
  return i._state === 'answered' ? { owner: i, interaction: true } : unknown(10015, 'Webhook');
}

/** Make the message the application posts for this interaction. */
// source: https://docs.discord.com/developers/resources/message "CHAT_INPUT_COMMAND"
export async function interactionMessage(ctx: HandlerContext, i: Row, body: Row, files: Upload[] = [], deferred = false, original = false): Promise<Row | Response> {
  const app = ctx.row(APP, String(i.application_id))!;
  const channel = ctx.row(CHANNEL, String(i.channel_id))!;
  return newMessage(ctx, channel, { user: String(app._bot), application: String(app.id), interaction: i, original },
    { ...body, ...(deferred ? { flags: (Number(body.flags ?? 0) & 64) | 128 } : {}) }, files);
}

/** Finish a deferred response; an existing message's ephemeral state is immutable. */
// source: https://docs.discord.com/developers/interactions/receiving-and-responding "an existing message’s ephemeral state cannot be changed"
export async function editInteractionMessage(ctx: HandlerContext, i: Row, m: Row, body: Row, files: Upload[] = []): Promise<Response> {
  const flags = (Number(body.flags ?? m.flags ?? 0) & ~192) | (Number(m.flags ?? 0) & 64);
  const result = await editMessage(ctx, { ...m, flags }, { ...body, flags }, undefined, files);
  if (i._deferred) await ctx.write(INTERACTION, String(i.id), { _deferred: false }, 'interaction.complete');
  return result;
}

/** Uploaded bytes belong to resource blobs; the row carries the vendor's attachment metadata. */
async function uploadedAttachments(ctx: HandlerContext, id: string, channel: string, body: Row, files: Upload[]): Promise<Row[]> {
  const attachments: Row[] = [];
  for (const f of files.sort((a, b) => a.index - b.index)) {
    const meta = arr(body.attachments).find((a) => Number(a.id) === f.index) ?? {};
    const aid = ctx.mint('_attachment');
    // source: https://docs.discord.com/developers/reference "upload files as attachments"
    const blob = `attachments/${id}/${aid}`;
    await ctx.blobs.put(blob, f.data);
    await ctx.record('_attachment', { message: id, blob }, aid);
    const name = String(meta.filename ?? f.name);
    // Where the documentation stops: the CDN's signed query (ex, is, hm) is the CDN's; the twin serves no CDN and names the file's path
    attachments.push({ id: aid, filename: name, size: f.bytes, url: `https://cdn.discordapp.com/attachments/${channel}/${aid}/${name}`, proxy_url: `https://media.discordapp.net/attachments/${channel}/${aid}/${name}`, content_type: f.type || 'application/octet-stream', ...(meta.description ? { description: meta.description } : {}) });
  }
  return attachments;
}
