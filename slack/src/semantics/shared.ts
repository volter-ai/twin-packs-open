// What Slack's handlers share: who is calling (their token), the workspace and org they act in, the objects Slack
// answers (a channel, a user, a message) as it answers them, and the events a workspace's activity sends an app.
import { sha256, type EventsDecl, type EventWrite, type HandlerContext, type WriteHookContext } from '@volter/world-core';
import { epochOf, HOME_TEAM, personOfToken, tokenKind, tsAt } from '../engine/wire.ts';
import { appName } from '../engine/app-manifest.ts';

type Row = Record<string, unknown>;

// ── answers ──────────────────────────────────────────────────────────────────────────────────────

/** Slack's refusal: HTTP 200, `{ok: false, error}` (https://docs.slack.dev/apis/web-api/#responses). */
export const fail = (ctx: HandlerContext, code: string): Response => ctx.refuse({ status: 200, code, message: code });

/** Slack's success: `{ok: true, …}`. */
export const ok = (ctx: HandlerContext, fields: Row = {}): Response => ctx.ok(fields);

/** A method's argument as a string, or undefined when absent or empty. */
export function arg(ctx: HandlerContext, name: string): string | undefined {
  const v = ctx.params[name];
  if (v === undefined || v === null || v === '') return undefined;
  return typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** A structured argument Slack takes as JSON text in a form (`blocks`, `profile`, `files`) or as JSON in a JSON body. */
export function jsonArg(ctx: HandlerContext, name: string): unknown {
  const v = ctx.params[name];
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return undefined; }
}

/** The request's World instant, as Slack's epoch seconds. */
export const now = (ctx: HandlerContext): number => epochOf(ctx.occurredAt);

// ── who is calling ──────────────────────────────────────────────────────────────────────────────

/** The caller a token names. A person acting in the client (`kind: 'person'`) may do all a person may; an app's token
 *  holds the scopes its install granted. */
export type Caller = {
  kind: 'person' | 'bot' | 'user' | 'config' | 'app';
  token: string;
  /** the person (a person's or a user token's), or the bot's user (a bot token's) */
  user: string;
  team: string;
  /** '*' for a person in the client */
  scopes: '*' | string[];
  app?: string;
  bot?: string;
  /** an org-wide install's token acts across the org's workspaces */
  enterprise?: boolean;
};

/** The token a request carries: `Authorization: Bearer …`, or the `token` argument ("Tokens should be passed as an HTTP
 *  Authorization header or as a POST parameter", https://docs.slack.dev/authentication/tokens). */
export function tokenOf(ctx: HandlerContext): string | undefined {
  const header = /^bearer\s+(\S+)/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  return header ?? arg(ctx, 'token');
}

/** A kept token: by its SHA-256, the twin never holding a credential in the clear (`_token`). */
export const TOKENS = '_token';
export const tokenKey = (token: string): string => sha256(token);

/** Who a request's token names, or the error Slack answers: `not_authed` for none, `invalid_auth` for one Slack does
 *  not know, `token_revoked` for one revoked, `account_inactive` for a deactivated person's
 *  (https://docs.slack.dev/reference/methods/auth.test, Errors). */
export function caller(ctx: HandlerContext, presented: string | undefined = tokenOf(ctx)): Caller | { error: string } {
  const token = presented;
  if (!token) return { error: 'not_authed' };
  const person = personOfToken(token);
  if (person) {
    const u = ctx.row('user', person, { withDeleted: true });
    if (!u) return { error: 'invalid_auth' };
    if (u.deleted === true) return { error: 'account_inactive' };
    return { kind: 'person', token, user: person, team: String(u.team_id ?? HOME_TEAM), scopes: '*' };
  }
  const kept = ctx.row(TOKENS, tokenKey(token));
  // a refresh token calls no method; it is an argument of tooling.tokens.rotate
  if (!kept || !tokenKind(token) || kept.kind === 'refresh') return { error: 'invalid_auth' };
  if (kept.revoked === true) return { error: 'token_revoked' };
  // an app configuration token lasts 12 hours ("The token will expire after 12 hours",
  // https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests#config-tokens)
  if (typeof kept.exp === 'number' && kept.exp <= epochOf(ctx.occurredAt)) return { error: 'token_expired' };
  const user = String(kept.user ?? '');
  if (user && ctx.row('user', user, { withDeleted: true })?.deleted === true) return { error: 'account_inactive' };
  return {
    kind: kept.kind as Caller['kind'], token, user, team: String(kept.team ?? HOME_TEAM), scopes: (kept.scopes as string[] | undefined) ?? [],
    ...(typeof kept.app === 'string' ? { app: kept.app } : {}), ...(typeof kept.bot === 'string' ? { bot: kept.bot } : {}),
    ...(kept.enterprise === true ? { enterprise: true } : {}),
  };
}

/** A handler's caller, whom around.ts has already let through. */
export function who(ctx: HandlerContext): Caller {
  const c = caller(ctx);
  if ('error' in c) throw new Error(`slack: ${c.error} past around`);
  return c;
}

/** Keep a token the twin issued. */
export async function keepToken(ctx: HandlerContext, token: string, fields: Row): Promise<void> {
  await ctx.write(TOKENS, tokenKey(token), { kind: tokenKind(token), ...fields }, 'token.issue');
}

// ── the org, its workspaces and people ────────────────────────────────────────────────────────────

/** A workspace, as team.info answers it (https://docs.slack.dev/reference/methods/team.info): Slack's default icon, at
 *  each size, until an admin sets one. */
// source: spec:/paths/~1team.info/get/responses/200/examples/application~1json/team/icon "image_default"
export function teamView(t: Row): Row {
  return {
    id: t.id, name: t.name, domain: t.domain, email_domain: t.email_domain ?? '',
    icon: { image_default: true, ...Object.fromEntries([34, 44, 68, 88, 102, 132].map((n) => [`image_${n}`, `https://a.slack-edge.com/80588/img/avatars-teams/ava_0001-${n}.png`])) },
    avatar_base_url: 'https://ca.slack-edge.com/',
  };
}

/** The workspaces a person belongs to: one `team_member` subject each (`<team>::<user>`), their home workspace first. */
export const teamsOf = (ctx: HandlerContext, user: string): string[] =>
  ctx.rowsRaw('team_member').filter((m) => m._user === user).map((m) => String(m._team));

/** A person becomes a member of a workspace (made there, or assigned to it on Grid). */
export async function addToTeam(ctx: HandlerContext, team: string, user: string, operation = 'team.member'): Promise<void> {
  await ctx.write('team_member', `${team}::${user}`, { _team: team, _user: user, date_joined: now(ctx), deleted: false }, operation);
}

/** A person as users.info answers them (https://docs.slack.dev/reference/objects/user-object); `has_2fa` only to a
 *  viewer who administers the workspace ("Only visible if the user executing the call is an admin"). */
// source: https://docs.slack.dev/reference/objects/user-object "has_2fa"
export function userView(ctx: HandlerContext, u: Row, team: string, admin = false): Row {
  const teams = teamsOf(ctx, String(u.id));
  const profile = (u.profile ?? {}) as Row;
  return {
    id: u.id, team_id: team, name: u.name, deleted: u.deleted === true, color: '9f69e7', real_name: profile.real_name ?? u.name,
    tz: 'Europe/London', tz_label: 'Greenwich Mean Time', tz_offset: 0,
    profile: profileView(profile, team),
    is_admin: u.is_admin === true, is_owner: u.is_owner === true, is_primary_owner: u.is_primary_owner === true,
    is_restricted: u.is_restricted === true, is_ultra_restricted: u.is_ultra_restricted === true, is_bot: u.is_bot === true,
    is_app_user: false, updated: u.updated ?? 0, is_email_confirmed: u.is_bot !== true, who_can_share_contact_card: 'EVERYONE',
    ...(admin && u.is_bot !== true ? { has_2fa: false } : {}),
    ...(u.is_bot === true && u.bot_id ? { profile: { ...profileView(profile, team), bot_id: u.bot_id } } : {}),
  };
}

/** A person's profile as the user object gives it, its normalized names the ones set (the object's
 *  `real_name_normalized` and `display_name_normalized`), its custom `fields` (none set by the World) and Slack's
 *  default picture at each size (no one sets their own through a World: users.setPhoto is unmodeled). */
// source: spec:/definitions/objs_user_profile "display_name_normalized"
// source: spec:/definitions/objs_user_profile "is_custom_image"
function profileView(profile: Row, team: string): Row {
  const p = { real_name: '', display_name: '', title: '', phone: '', skype: '', status_text: '', status_emoji: '', status_expiration: 0, avatar_hash: '', fields: {}, ...profile, team };
  const pictures = Object.fromEntries([24, 32, 48, 72, 192, 512].map((n) => [`image_${n}`, `https://a.slack-edge.com/80588/img/avatars/ava_0001-${n}.png`]));
  return { ...p, real_name_normalized: String(p.real_name), display_name_normalized: String(p.display_name), is_custom_image: false, ...pictures };
}

// ── channels ────────────────────────────────────────────────────────────────────────────────────

/** A channel's members, in the order they joined: one `channel_member` subject each (`<channel>::<user>`). */
export const channelMembers = (ctx: HandlerContext, channel: string): string[] =>
  ctx.rowsRaw('channel_member').filter((m) => m._channel === channel).map((m) => String(m._user));

/** A person joins a conversation (joined, invited, or its creator): their membership subject. */
export async function addMember(ctx: HandlerContext, channel: string, user: string, operation = 'channel.join'): Promise<void> {
  await ctx.write('channel_member', `${channel}::${user}`, { _channel: channel, _user: user, joined: now(ctx), deleted: false }, operation);
}

/** What Slack posts in a channel as it changes (a member joins, the channel is renamed, its topic or purpose set): a
 *  message of the change's subtype, from the person who made it, which history reads with the rest
 *  (https://docs.slack.dev/reference/events/message/channel_join, …/channel_name, …/channel_topic, …/channel_purpose). */
// source: https://docs.slack.dev/reference/events/message/channel_join "A member joined a channel"
export async function systemMessage(ctx: HandlerContext, channel: Row, user: string, subtype: 'channel_join' | 'channel_name' | 'channel_topic' | 'channel_purpose', fields: Row = {}): Promise<void> {
  if (channel.is_im === true || channel.is_mpim === true) return;
  const text = subtype === 'channel_join' ? `<@${user}> has joined the channel`
    : subtype === 'channel_name' ? `<@${user}> has renamed the channel from "${String(fields.old_name)}" to "${String(fields.name)}"`
    : subtype === 'channel_topic' ? `<@${user}> set the channel topic: ${String(fields.topic)}`
    : `<@${user}> set the channel description: ${String(fields.purpose)}`;
  const ts = nextTs(ctx, String(channel.id));
  await ctx.write('message', messageId(String(channel.id), ts), { type: 'message', subtype, channel: channel.id, user, ts, team: channel.team_id, text, ...fields }, 'message.system');
}

/** A person leaves a conversation (left, kicked, or removed with their account): their membership gone. */
export async function removeMember(ctx: HandlerContext, channel: string, user: string, operation = 'channel.leave'): Promise<void> {
  await ctx.remove('channel_member', `${channel}::${user}`, operation);
}

/** A conversation a request names: its id, or a public channel's `#name` in the caller's workspace (chat.postMessage's
 *  `channel`: "Channel, private group, or IM channel to send message to. Can be an encoded ID, or a name"). */
export function channelNamed(ctx: HandlerContext, named: string | undefined, team: string): Row | undefined {
  if (!named) return undefined;
  const raw = (id: string): Row | undefined => ctx.row('channel', id, { withDeleted: false });
  if (named.startsWith('#')) return ctx.rowsRaw('channel').find((c) => c.name === named.slice(1) && c.team_id === team);
  return raw(named) ?? ctx.rowsRaw('channel').find((c) => c.name === named && c.team_id === team);
}

/** Whether a caller may see a conversation: a public channel in its workspace (or the org's, for an org install), or
 *  one it is a member of ("channel_not_found: Value passed for channel was invalid", for one the caller cannot see). */
export function sees(ctx: HandlerContext, c: Row, by: Caller): boolean {
  const member = channelMembers(ctx, String(c.id)).includes(by.user);
  if (c.is_private === true || c.is_im === true || c.is_mpim === true) return member;
  return by.enterprise === true || c.team_id === by.team || member;
}

/** A channel's earlier names, the latest first: read from its own history (each write that named it), never kept. */
function previousNames(ctx: HandlerContext, channel: string): string[] {
  const names = ctx.history('channel', channel).map((h) => h.fields?.name).filter((n): n is string => typeof n === 'string');
  return names.slice(0, -1).reverse();
}

/** A conversation as conversations.info answers it (https://docs.slack.dev/reference/objects/conversation-object). */
export function channelView(ctx: HandlerContext, c: Row, by?: Caller): Row {
  const members = channelMembers(ctx, String(c.id));
  if (c.is_im === true) {
    // a DM's whole definition carries the caller's read marker, its newest message, what is unread and that it is open;
    // where the documentation stops: what is unread is the other person's messages past the caller's read marker
    // source: https://docs.slack.dev/reference/methods/conversations.open "Passing return_im will expand the response to include more info about a conversation"
    const lastRead = String(ctx.row('channel_member', `${String(c.id)}::${String(by?.user)}`)?.last_read ?? '0000000000.000000');
    const messages = messagesIn(ctx, String(c.id)).sort((a, b) => Number(a.ts) - Number(b.ts));
    const unread = messages.filter((m) => Number(m.ts) > Number(lastRead) && m.user !== by?.user).length;
    return { id: c.id, created: c.created, is_archived: false, is_im: true, is_org_shared: false, context_team_id: c.team_id, updated: c.updated ?? c.created, user: members.find((m) => m !== by?.user) ?? members[0], is_user_deleted: false, last_read: lastRead, latest: messages.length ? messageView(ctx, messages.at(-1)!) : null, unread_count: unread, unread_count_display: unread, is_open: true, priority: 0 };
  }
  return {
    id: c.id, name: c.name, is_channel: c.is_private !== true, is_group: c.is_private === true, is_im: false, is_mpim: false,
    is_private: c.is_private === true, created: c.created, is_archived: c.is_archived === true, is_general: c.is_general === true,
    unlinked: 0, name_normalized: c.name, is_shared: c.is_ext_shared === true, is_org_shared: false, pending_shared: [],
    is_pending_ext_shared: false,
    context_team_id: c.team_id, updated: c.updated ?? c.created, parent_conversation: null, creator: c.creator,
    is_ext_shared: c.is_ext_shared === true, shared_team_ids: [c.team_id], pending_connected_team_ids: [],
    ...(by ? { is_member: members.includes(by.user), last_read: String(ctx.row('channel_member', `${String(c.id)}::${by.user}`)?.last_read ?? '0000000000.000000') } : {}),
    topic: c.topic ?? { value: '', creator: '', last_set: 0 }, purpose: c.purpose ?? { value: '', creator: '', last_set: 0 },
    previous_names: previousNames(ctx, String(c.id)), priority: 0, is_read_only: false,
  };
}

// ── messages ────────────────────────────────────────────────────────────────────────────────────

/** A message's stored id: its channel and its ts (a ts is unique within its channel). */
export const messageId = (channel: string, ts: string): string => `${channel}:${ts}`;

/** The channel's messages, oldest first (threads' replies included). */
export const messagesIn = (ctx: HandlerContext, channel: string): Row[] => ctx.rows('message').filter((m) => m.channel === channel && m.deleted !== true);

/** A ts no message of the channel holds, at this request's second. */
export function nextTs(ctx: HandlerContext, channel: string): string {
  const second = now(ctx);
  const taken = new Set(ctx.rowsRaw('message', { withDeleted: true }).filter((m) => m.channel === channel).map((m) => String(m.ts)));
  let seq = 1;
  while (taken.has(tsAt(second, seq))) seq += 1;
  return tsAt(second, seq);
}

/** A message as conversations.history answers it (https://docs.slack.dev/reference/objects/message-object): its
 *  channel is the call's, not the message's own. Its reactions (one `reaction` subject per person and name), the
 *  channels it is pinned to (one `pin` subject each) and, for a thread's parent, its replies' count, people and latest
 *  (the thread's own messages, "Threaded messages", https://docs.slack.dev/messaging#threading) are read, never kept. */
export function messageView(ctx: HandlerContext, m: Row): Row {
  const { channel: _c, deleted: _d, id: _id, ...rest } = m;
  // a message's `type` is always `message` (the kernel keeps its own `type` on the row); the app that posted it is kept, and
  // named in its bot_profile, not on the message the spec describes
  // source: spec:/definitions/objs_message "type"
  const view: Row = { type: 'message', ...Object.fromEntries(Object.entries(rest).filter(([k, v]) => !k.startsWith('_') && k !== 'app_id' && k !== 'type' && !(Array.isArray(v) && v.length === 0 && k === 'files') && !(k === 'blocks' && v === null))) };
  const id = messageId(String(m.channel), String(m.ts));
  const reactions: Array<{ name: string; users: string[]; count: number }> = [];
  for (const r of ctx.rowsRaw('reaction').filter((x) => x._message === id)) {
    const held = reactions.find((x) => x.name === r.reaction);
    if (held) { held.users.push(String(r.user)); held.count += 1; } else reactions.push({ name: String(r.reaction), users: [String(r.user)], count: 1 });
  }
  if (reactions.length) view.reactions = reactions;
  const pins = ctx.rowsRaw('pin').filter((x) => messageId(String(x.channel), String(x._ts)) === id).map((x) => String(x.channel));
  if (pins.length) view.pinned_to = pins;
  const replies = ctx.rowsRaw('message').filter((x) => x.channel === m.channel && x.thread_ts === m.ts && x.ts !== m.ts && x.deleted !== true);
  if (replies.length) {
    const users = [...new Set(replies.map((x) => String(x.user)))];
    Object.assign(view, { thread_ts: m.ts, reply_count: replies.length, reply_users_count: users.length, reply_users: users, latest_reply: replies.map((x) => String(x.ts)).sort().at(-1) });
  }
  return view;
}

/** A row as the vendor shows it: the twin's own bookkeeping (`_` fields) left out. */
// (the kernel's own `updatedAt` and `deleted` are no field of a Slack message)
export const shown = (r: Row | undefined): Row | undefined => (r ? Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_') && k !== 'updatedAt' && k !== 'deleted')) : r);

/** A message's link, `https://<domain>.slack.com/archives/<channel>/p<ts without the dot>`. */
export function permalinkOf(ctx: HandlerContext, channel: Row, ts: string): string {
  const domain = String(ctx.get('team', String(channel.team_id))?.domain ?? 'twin');
  return `https://${domain}.slack.com/archives/${String(channel.id)}/p${ts.replace('.', '')}`;
}

/** Post a message into a conversation as the caller (a reply names its thread; the parent's thread fields are read from
 *  its replies, messageView). */
export async function post(ctx: HandlerContext, channel: Row, by: Caller, fields: Row): Promise<Row> {
  const ts = nextTs(ctx, String(channel.id));
  const thread = typeof fields.thread_ts === 'string' && fields.thread_ts ? fields.thread_ts : undefined;
  const message: Row = {
    type: 'message', channel: channel.id, user: by.user, ts, team: channel.team_id, ...fields,
    ...(by.bot ? { bot_id: by.bot, app_id: by.app } : {}),
    ...(thread ? { thread_ts: thread, parent_user_id: ctx.row('message', messageId(String(channel.id), thread))?.user } : {}),
  };
  const written = await ctx.write('message', messageId(String(channel.id), ts), message, 'message.create');
  if (!by.bot) await shareLinks(ctx, written);
  return written;
}

/** The links a person's message carries, shared with the apps whose unfurl domains take them: one `link_share` (its id
 *  the `unfurl_id` chat.unfurl may name), sent as `link_shared` (https://docs.slack.dev/reference/events/link_shared).
 *  A message shares its links once. */
// source: https://docs.slack.dev/reference/events/link_shared "link_shared"
export async function shareLinks(ctx: HandlerContext, m: Row): Promise<Row | undefined> {
  const held = ctx.rowsRaw('link_share').find((l) => l.channel === m.channel && l.message_ts === m.ts);
  if (held) return held;
  // a link is what parses as a URL (`https://[x` does not)
  const links = [...String(m.text ?? '').matchAll(/<?(https?:\/\/[^\s|>]+)/g)].flatMap((x) => { try { return [{ url: x[1]!, domain: new URL(x[1]!).hostname }]; } catch { return []; } });
  if (!links.length) return undefined;
  const id = ctx.mint('link_share');
  return ctx.write('link_share', id, { channel: m.channel, user: m.user, message_ts: m.ts, team: m.team, links }, 'link.share');
}

// ── the Events API (https://docs.slack.dev/apis/events-api) ───────────────────────────────────────

/** The events a workspace's activity sends the apps that subscribed to them at their Request URL, signed with each
 *  app's signing secret (`X-Slack-Signature: v0=<hex HMAC-SHA256 of "v0:<timestamp>:<body>">`,
 *  https://docs.slack.dev/authentication/verifying-requests-from-slack), in the `event_callback` envelope. */
/** The events Slack sent apps' Request URLs, as the kernel records each (url, body, headers, event_type, sent_at). */
export const EVENT_DELIVERIES = '_event_delivery';

/** The events Slack sends only to the app they are about. */
export const APP_EVENTS = ['app_mention', 'app_home_opened', 'link_shared', 'app_uninstalled', 'tokens_revoked'];

export const SLACK_EVENTS: EventsDecl = {
  scheme: { kind: 'hmac', header: 'X-Slack-Signature', encoding: 'hex', prefix: 'v0=', timestampHeader: 'X-Slack-Request-Timestamp', signed: 'v0:{t}:{body}' },
  types: {
    // a message is sent to the apps subscribed to messages, and as app_mention to each app it mentions
    'message.create': ['message', 'app_mention'], 'channel.create': 'channel_created', 'channel.archive': 'channel_archive', 'channel.rename': 'channel_rename',
    'channel.join': 'member_joined_channel', 'reaction.add': 'reaction_added', 'reaction.remove': 'reaction_removed', 'pin.add': 'pin_added', 'user.join': 'team_join',
    'home.open': 'app_home_opened', 'link.share': 'link_shared', 'app.uninstall': 'app_uninstalled', 'token.revoke': 'tokens_revoked',
  },
  // "api_app_id": the app the event is sent to (each Request URL is one app's)
  envelope: { token: '$endpoint.credentials.verification_token', team_id: '$team', api_app_id: '$endpoint.id', event: '$data', type: 'event_callback', event_id: '$id', event_time: '$time.s', authorizations: [] },
  endpoints: [
    { storedAs: 'app', url: 'manifest.settings.event_subscriptions.request_url', secret: 'credentials.signing_secret', disabled: 'manifest.settings.socket_mode_enabled', filter: 'manifest.settings.event_subscriptions.bot_events', skip: [...APP_EVENTS, 'message'], match: { id: '$installedApps' } },
    // The subscription is message.channels/groups/im/mpim; the wire event remains message. Match the vendor's
    // subscription and the installed bots that can receive this conversation, using the kernel's endpoint matcher.
    { storedAs: 'app', url: 'manifest.settings.event_subscriptions.request_url', secret: 'credentials.signing_secret', disabled: 'manifest.settings.socket_mode_enabled', types: ['message'], match: { id: '$apps', 'manifest.settings.event_subscriptions.bot_events': '$subscription' } },
    // the events about one app go to that app alone: the one a message mentions, whose Home was opened, whose unfurl
    // domain a shared link is on, uninstalled, or whose tokens were revoked
    { storedAs: 'app', url: 'manifest.settings.event_subscriptions.request_url', secret: 'credentials.signing_secret', disabled: 'manifest.settings.socket_mode_enabled', filter: 'manifest.settings.event_subscriptions.bot_events', types: APP_EVENTS, match: { id: '$apps' } },
  ],
  // each event sent, as its app's server was sent it (the deliveries door reads them)
  record: EVENT_DELIVERIES,
};

// ── apps (https://docs.slack.dev/app-manifests) ────────────────────────────────────────────────────────

/** An app's credentials: a client id of two numbers (`1234567890.1234567890`, the form Slack's take), its secret, the
 *  deprecated verification token and the signing secret. The client id is derived from the app (it is public); the three
 *  secrets are drawn from secrets the World holds for it (ctx.secret), so no one computes them from the app's id. */
export async function credentialsFor(ctx: HandlerContext, app: string): Promise<Row> {
  const d = (label: string): string => ctx.crypto.digest('sha256', `${label}:${app}`, 'hex');
  const s = async (label: string): Promise<string> => ctx.crypto.digest('sha256', await ctx.secret(`slack-app-${label}:${app}`), 'hex');
  const digits = (label: string): string => String(BigInt(`0x${d(label).slice(0, 12)}`)).padStart(13, '0').slice(0, 13);
  return { client_id: `${digits('client-a')}.${digits('client-b')}`, client_secret: (await s('secret')).slice(0, 32), verification_token: (await s('verify')).slice(0, 24), signing_secret: (await s('sign')).slice(0, 32) };
}

/** Make an app from its manifest in a workspace (`team`; `made_in` names another workspace it was made in, whose
 *  app the World's people install when it is distributed). Answers the app with its credentials. */
export async function makeApp(ctx: HandlerContext, manifest: Row, fields: { team: string; creator?: string; made_in?: string; distributed?: boolean }): Promise<Row> {
  const id = ctx.mint('app');
  const credentials = await credentialsFor(ctx, id);
  const app = await ctx.write('app', id, {
    manifest, credentials, team_id: fields.team, creator: fields.creator ?? null, ...(fields.made_in ? { made_in: fields.made_in } : {}),
    distributed: fields.distributed === true, date_created: now(ctx),
  }, 'app.create');
  await verifyRequestUrl(ctx, app);
  return app;
}

/** The app a client id names, when it exists. */
export const appOfClient = (ctx: HandlerContext, clientId: string | undefined): Row | undefined =>
  clientId ? ctx.rowsRaw('app').find((a) => (a.credentials as Row | undefined)?.client_id === clientId && a.deleted !== true) : undefined;

/** A fresh number for a code the World issues: each draw its own numbered subject of `_serial`, minted from the tree. */
export async function serial(ctx: HandlerContext, what: string): Promise<string> {
  const n = ctx.mint('_serial');
  await ctx.record('_serial', { what }, n);
  return n;
}

/** A token, as the twin mints one: its prefix, then letters derived from what it is for. */
export async function mintToken(ctx: HandlerContext, prefix: string, label: string): Promise<string> {
  // drawn from a secret the World holds (ctx.secret), so no one computes a token from what it is for and when
  const d = ctx.crypto.digest('sha256', await ctx.secret(`${label}:${ctx.occurredAt}`), 'hex');
  return `${prefix}${String(BigInt(`0x${d.slice(0, 10)}`))}-${String(BigInt(`0x${d.slice(10, 20)}`))}-${d.slice(20, 44)}`;
}

// ── app configuration tokens (https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests#config-tokens) ──

/** A configuration token and its refresh token for a person in a workspace: the access token lasts 12 hours; the
 *  refresh token makes the next pair (tooling.tokens.rotate) and is spent doing so. */
export async function issueConfigTokens(ctx: HandlerContext, user: string, team: string): Promise<{ token: string; refresh_token: string; iat: number; exp: number }> {
  const iat = now(ctx);
  const exp = iat + 12 * 3600;
  const issuance = await serial(ctx, 'config_pair');
  const token = await mintToken(ctx, 'xoxe.xoxp-1-', `config:${user}:${team}:${issuance}`);
  const refresh = await mintToken(ctx, 'xoxe-1-', `refresh:${user}:${team}:${issuance}`);
  await keepToken(ctx, token, { user, team, scopes: [], iat, exp });
  await keepToken(ctx, refresh, { user, team, scopes: [], pairs: tokenKey(token) });
  return { token, refresh_token: refresh, iat, exp };
}

// ── installs (https://docs.slack.dev/authentication/installing-with-oauth) ──────────────────────────────

/** An authorization code the install page issued, kept until its app exchanges it (`_oauth_code`): the app, the
 *  person who allowed it, where (a workspace, or the whole org), the scopes granted, and the channel an incoming
 *  webhook posts to. */
export const CODES = '_oauth_code';

// ── user groups (https://docs.slack.dev/reference/objects/usergroup-object) ────────────────────────────────

/** Workspace user groups, in their stored order; no identity-provider group is joined into this projection. */
export function groupsIn(ctx: HandlerContext, team: string): Row[] {
  return ctx.rowsRaw('usergroup').filter((g) => g.team_id === team);
}

/** A workspace user group's members and default channels: one subject each
 *  (`usergroup_member`, `usergroup_channel`, keyed `<group>::<member>`). */
export const groupMembers = (ctx: HandlerContext, group: string): string[] => ctx.rowsRaw('usergroup_member').filter((x) => x._usergroup === group).map((x) => String(x._user));
export const groupChannels = (ctx: HandlerContext, group: string): string[] => ctx.rowsRaw('usergroup_channel').filter((x) => x._usergroup === group).map((x) => String(x._channel));

/** A set of a group made what the call names: members (or channels) it lacks added, those it no longer names removed. */
export async function setGroupSet(ctx: HandlerContext, kind: 'usergroup_member' | 'usergroup_channel', group: string, want: string[], operation: string): Promise<void> {
  const field = kind === 'usergroup_member' ? '_user' : '_channel';
  const held = kind === 'usergroup_member' ? groupMembers(ctx, group) : groupChannels(ctx, group);
  for (const x of held.filter((h) => !want.includes(h))) await ctx.remove(kind, `${group}::${x}`, operation);
  for (const x of want.filter((w) => !held.includes(w))) await ctx.write(kind, `${group}::${x}`, { _usergroup: group, [field]: x, deleted: false }, operation);
}

/** A user group as usergroups.list answers it; a call on one group answers its members too (`users`). */
export function groupView(ctx: HandlerContext, g: Row, team: string, withUsers = false): Row {
  const users = groupMembers(ctx, String(g.id));
  const channels = groupChannels(ctx, String(g.id));
  return {
    id: g.id, team_id: team, enterprise_subteam_id: '', is_usergroup: true, is_subteam: true, name: g.name,
    description: g.description ?? '', handle: g.handle, is_external: g.is_external === true, date_create: g.date_create, date_update: g.date_update ?? g.date_create,
    date_delete: g.date_delete ?? 0, auto_type: null, auto_provision: false, created_by: g.created_by, updated_by: g.updated_by ?? g.created_by, deleted_by: g.deleted_by ?? null,
    prefs: { channels, groups: [] }, ...(withUsers ? { users } : {}), user_count: users.length, channel_count: channels.length,
  };
}

// ── what Slack sends people and apps ────────────────────────────────────────────────────────────────

/** A mail Slack sent a person (`_mail`): what their inbox holds (the World's door reads it: ./doors.ts). */
export const MAIL = '_mail';
/** A request Slack sent an app's server (`_delivery`): what its server received. */
export const DELIVERIES = '_delivery';

/** The response URLs Slack handed apps with a command or an interaction (../screens/response-url.ts). */
export const RESPONSE_URLS = '_response_url';

/** Keep a mail Slack sends: to whom, its subject, its text and its links. */
export async function sendMail(ctx: HandlerContext, to: string, subject: string, text: string, links: Array<{ text: string; href: string }>): Promise<void> {
  await ctx.record(MAIL, { to, subject, text, links, sent: now(ctx) }, ctx.mint('_mail'));
}

/** A request Slack sends an app's server and decides by its answer: a slash command, an interaction. Form-encoded and
 *  signed like events (`X-Slack-Signature`), and the app has 3 seconds to acknowledge it ("Your app must respond within
 *  3000ms", https://docs.slack.dev/interactivity/handling-user-interaction#acknowledgment_response). Kept, with its
 *  answer's status, as a delivery. */
export async function askApp(ctx: HandlerContext, url: string, payload: Row, signingSecret: string): Promise<{ status: number; body: string; missed?: string }> {
  const body = new URLSearchParams(Object.entries(payload).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])).toString();
  const ts = String(now(ctx));
  const signature = `v0=${ctx.crypto.hmac(signingSecret, `v0:${ts}:${body}`)}`;
  const answer = await ctx.ask(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-slack-request-timestamp': ts, 'x-slack-signature': signature }, body }, 3000);
  await ctx.record(DELIVERIES, { to: url, payload, sent: now(ctx), status: answer.status, ...(answer.missed ? { missed: answer.missed } : {}) }, ctx.mint('_delivery'));
  return answer;
}

/** Whether an app takes Slack's requests over Socket Mode ("this WebSocket URL replaces the public Request URL",
 *  https://docs.slack.dev/apis/events-api/using-socket-mode): its manifest's `settings.socket_mode_enabled`. */
export const socketMode = (app: Row | undefined): boolean => ((app?.manifest as Row | undefined)?.settings as Row | undefined)?.socket_mode_enabled === true;

/** The Socket Mode tickets apps.connections.open issued, each opened once (its app, the workspace, when). */
export const SOCKET_TICKETS = '_socket_ticket';

/** A request Slack asks an app over its Socket Mode connection (a slash command, an interaction): sent on one of the
 *  app's open connections as `{payload, envelope_id, type, accepts_response_payload}`, and acknowledged by the app's
 *  `{envelope_id, payload?}` within the same 3 seconds. Kept as a delivery to `socket:<app>`. */
// source: https://docs.slack.dev/apis/events-api/using-socket-mode "Your app still needs to acknowledge receiving each event"
export async function askAppSocket(ctx: HandlerContext, app: Row, type: 'slash_commands' | 'interactive', payload: Row): Promise<{ status: number; body: string; missed?: string }> {
  const to = `socket:${String(app.id)}`;
  const session = ctx.sockets('socketMode').find((s) => s.state.app === app.id);
  if (!session) {
    await ctx.record(DELIVERIES, { to, payload, sent: now(ctx), status: 0, missed: 'unreachable' }, ctx.mint('_delivery'));
    return { status: 0, body: '', missed: 'unreachable' };
  }
  const envelope = ctx.crypto.uuidFrom(`socket-envelope:${await serial(ctx, 'socket_envelope')}`);
  session.send({ payload, envelope_id: envelope, type, accepts_response_payload: true });
  let ack: unknown;
  try { ack = await session.expect(envelope, 3000); } catch {
    await ctx.record(DELIVERIES, { to, payload, sent: now(ctx), status: 0, missed: 'timeout' }, ctx.mint('_delivery'));
    return { status: 0, body: '', missed: 'timeout' };
  }
  await ctx.record(DELIVERIES, { to, payload, sent: now(ctx), status: 200 }, ctx.mint('_delivery'));
  const reply = (ack as Row | undefined)?.payload;
  return { status: 200, body: reply === undefined ? '' : JSON.stringify(reply) };
}

/** The Events API's handshake: when an app's Request URL is set, Slack sends it a `url_verification` payload (`token`,
 *  `challenge`, `type`), signed as every event, and the app answers the challenge ("respond in plaintext with the
 *  challenge attribute value"); whether it did is kept on the app (`_request_url_verified`). */
// source: https://docs.slack.dev/reference/events/url_verification "respond in plaintext with the"
export async function verifyRequestUrl(ctx: HandlerContext, app: Row): Promise<void> {
  const url = ((((app.manifest as Row | undefined)?.settings as Row | undefined)?.event_subscriptions as Row | undefined)?.request_url) as string | undefined;
  // a Socket Mode app has no Request URL Slack calls
  if (typeof url !== 'string' || !url || socketMode(app)) return;
  const credentials = app.credentials as Row;
  const challenge = ctx.crypto.digest('sha256', `challenge:${String(app.id)}:${url}:${ctx.occurredAt}`, 'base64url').slice(0, 52);
  const body = JSON.stringify({ token: credentials.verification_token, challenge, type: 'url_verification' });
  const ts = String(now(ctx));
  const signature = `v0=${ctx.crypto.hmac(String(credentials.signing_secret), `v0:${ts}:${body}`)}`;
  const answer = await ctx.ask(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': ts, 'x-slack-signature': signature }, body }, 3000);
  await ctx.record(DELIVERIES, { to: url, payload: JSON.parse(body), sent: now(ctx), status: answer.status, ...(answer.missed ? { missed: answer.missed } : {}) }, ctx.mint('_delivery'));
  const answered = answer.body.trim();
  let json: unknown;
  try { json = JSON.parse(answered); } catch { json = undefined; }
  const verified = answer.status === 200 && (answered === challenge || (json !== null && typeof json === 'object' && (json as Row).challenge === challenge));
  await ctx.write('app', String(app.id), { _request_url_verified: verified, _request_url: url }, 'app.request_url_verified');
}

/** An app's reply to a command or an interaction (its acknowledgement's body, or a post to a response URL): in the
 *  channel as the app (`response_type: in_channel`), or to the person alone, ephemeral (the default). */
export async function replyAsApp(ctx: HandlerContext, f: { app: string; team: string; channel: string; user: string }, reply: Row): Promise<boolean> {
  const bot = ctx.rowsRaw('user').find((u) => u.is_bot === true && u.app_id === f.app && u.deleted !== true);
  const channel = ctx.row('channel', f.channel);
  if (!bot || !channel) return false;
  const content: Row = { text: typeof reply.text === 'string' ? reply.text : '', ...(Array.isArray(reply.blocks) ? { blocks: reply.blocks } : {}) };
  if (reply.response_type === 'in_channel') {
    await post(ctx, channel, { kind: 'bot', token: '', user: String(bot.id), team: f.team, scopes: [], bot: String(bot.bot_id), app: f.app }, { ...content, ...(typeof reply.thread_ts === 'string' ? { thread_ts: reply.thread_ts } : {}) });
  } else {
    const id = ctx.mint('ephemeral');
    await ctx.write('ephemeral', id, { channel: channel.id, user: f.user, app: f.app, bot_id: bot.bot_id, ...content, ts: `${now(ctx)}.${id.padStart(6, '0')}` }, 'ephemeral.create');
  }
  return true;
}

// ── invitations (https://slack.com/help/articles/201330256-Invite-new-members-to-your-workspace) ───────────────────

/** Invite a person to a workspace: the invitation, and the email Slack sends them with its Join Now link. */
export async function invite(ctx: HandlerContext, i: { email: string; team: string; by: string; guest?: boolean; channels?: string[] }): Promise<string> {
  const id = ctx.mint('invitation');
  const link = `https://slack.com/join/invite/${id}`;
  await ctx.write('invitation', id, { email: i.email, team_id: i.team, invited_by: i.by, guest: i.guest === true, channels: i.channels ?? [], link, date_created: now(ctx), accepted: false }, 'invitation.create');
  const team = ctx.get('team', i.team);
  const inviter = ctx.get('user', i.by);
  const who = String(((inviter?.profile as Row | undefined)?.real_name) ?? inviter?.name ?? 'Someone');
  await sendMail(ctx, i.email, `${who} has invited you to work with them in Slack`, `${who} has invited you to join the Slack workspace ${String(team?.name ?? '')}. Join now to start collaborating!`, [{ text: 'Join Now', href: link }]);
  return id;
}

/** The file type Slack names by a filename's extension (https://docs.slack.dev/reference/objects/file-object#types). */
export function filetypeOf(name: string): { filetype: string; mimetype: string; pretty_type: string } {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  const known: Record<string, [string, string]> = {
    pdf: ['application/pdf', 'PDF'], png: ['image/png', 'PNG'], jpg: ['image/jpeg', 'JPEG'], jpeg: ['image/jpeg', 'JPEG'], gif: ['image/gif', 'GIF'],
    zip: ['application/zip', 'Zip'], txt: ['text/plain', 'Plain Text'], csv: ['text/csv', 'CSV'], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Excel Spreadsheet'],
  };
  const [mimetype, pretty] = known[ext] ?? ['application/octet-stream', 'Binary'];
  return { filetype: ext === 'jpeg' ? 'jpg' : ext || 'binary', mimetype, pretty_type: pretty };
}

/** A file as files.info answers it (https://docs.slack.dev/reference/objects/file-object): public once shared in a public
 *  channel, its shares each message that carried it, and an image's size, thumbnails and public link. */
// source: spec:/paths/~1files.info/get/responses/200/examples/application~1json/file "shares"
export function fileView(ctx: HandlerContext, f: Row, domain: string): Row {
  const id = String(f.id);
  const name = String(f.name ?? '');
  const type = filetypeOf(name);
  const shares: Record<string, Record<string, Row[]>> = {};
  for (const s of (f._shares as Array<{ channel: string; ts: string }> | undefined) ?? []) {
    const c = ctx.row('channel', s.channel);
    if (!c) continue;
    const kind = c.is_private === true || c.is_im === true ? 'private' : 'public';
    ((shares[kind] ??= {})[s.channel] ??= []).push({ reply_users: [], reply_users_count: 0, reply_count: 0, ts: s.ts, channel_name: c.name ?? '', team_id: c.team_id, share_user_id: f.user });
  }
  const at = `https://files.slack.com/files-tmb/${String(f.team_id)}-${id}-${String(f._sha256 ?? '').slice(0, 10)}/${encodeURIComponent(name.replace(/\.[^.]+$/, ''))}`;
  const image = typeof f.original_w === 'number' ? {
    original_w: f.original_w, original_h: f.original_h, image_exif_rotation: 1,
    thumb_64: `${at}_64.png`, thumb_80: `${at}_80.png`, thumb_160: `${at}_160.png`, thumb_360: `${at}_360.png`,
    thumb_360_w: Math.min(360, Number(f.original_w)), thumb_360_h: Math.min(360, Number(f.original_h)),
    ...(type.filetype === 'gif' ? { thumb_360_gif: `${at}_360.gif`, deanimate_gif: `${at}_deanimate_gif.png`, pjpeg: `${at}_pjpeg.jpg` } : {}),
    ...(type.filetype === 'jpg' ? { pjpeg: `${at}_pjpeg.jpg` } : {}),
  } : {};
  const channels = (f.channels as string[] | undefined) ?? [];
  return {
    id, created: f.created, timestamp: f.created, name, title: f.title ?? name, ...type, user: f.user, user_team: f.team_id,
    editable: false, size: f.size ?? 0, mode: 'hosted', is_external: false, external_type: '', is_public: channels.length > 0, public_url_shared: false,
    display_as_bot: false, username: '', url_private: `https://files.slack.com/files-pri/${String(f.team_id)}-${id}/${encodeURIComponent(name)}`,
    url_private_download: `https://files.slack.com/files-pri/${String(f.team_id)}-${id}/download/${encodeURIComponent(name)}`,
    permalink: `https://${domain}.slack.com/files/${String(f.user)}/${id}/${encodeURIComponent(name)}`,
    permalink_public: `https://slack-files.com/${String(f.team_id)}-${id}-${String(f._sha256 ?? '').slice(10, 20)}`,
    ...image, channels, groups: f.groups ?? [], ims: f.ims ?? [], comments_count: 0, has_rich_preview: false, is_starred: false,
    ...(Object.keys(shares).length ? { shares } : {}),
  };
}

/** An app removed from a workspace (apps.uninstall, or a member's Remove App on Manage apps): its tokens in the workspace
 *  revoked (tokens_revoked), and its install there ended (app_uninstalled). */
export async function uninstallApp(ctx: HandlerContext, app: Record<string, unknown>, team: string): Promise<void> {
  for (const t of ctx.rowsRaw(TOKENS)) {
    if (t.app === app.id && (t.team === team || t.enterprise === true) && t.revoked !== true) await ctx.write(TOKENS, String(t.id), { revoked: true }, 'token.revoke');
  }
  const install = ctx.row('app_install', `${String(app.id)}::${team}`);
  if (install) await ctx.remove('app_install', String(install.id), 'app.uninstall');
}

// ── how Slack renders the events its workspace's activity sends (the manifest's `events`: SLACK_EVENTS above) ──────

// The event object each write names (https://docs.slack.dev/reference/events), read from the stored subject (a write's body
// is its rendered view), and the values the envelope and the endpoints read: the workspace, and the apps an event about
// one app goes to. The manifest and the Socket Mode connection (./sockets.ts) read them alike.
const eventChannelType = (channel: Row | undefined): string => channel?.is_im === true ? 'im' : channel?.is_mpim === true ? 'mpim' : channel?.is_private === true ? 'group' : 'channel';

/** An app's live installed bot receives conversation events only where that bot is a member. */
function installedApps(ctx: WriteHookContext, team: string, channel?: string, scope?: string): string[] {
  const members = channel === undefined ? undefined : new Set(ctx.rowsRaw('channel_member').filter((r) => r._channel === channel).map((r) => String(r._user)));
  return [...new Set(ctx.rowsRaw('_token').filter((r) => r.kind === 'bot' && r.team === team && r.revoked !== true
    && (members === undefined || members.has(String(r.user)))
    && (scope === undefined || ((r.scopes as string[] | undefined) ?? []).includes(scope))).map((r) => String(r.app)))];
}

/** The written subject as kept, its bookkeeping with it, and one just removed too. */
const storedSubject = (ctx: WriteHookContext, write: EventWrite): Row => ctx.row(write.storedType, String(write.body.id ?? ''), { withDeleted: true }) ?? write.body;

/** The apps a message mentions: bot users named `<@U…>` in its text, by their apps. */
function mentioned(ctx: WriteHookContext, text: unknown): string[] {
  const users = [...String(text ?? '').matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]!);
  return [...new Set(users.map((u) => ctx.row('user', u)).filter((u) => u?.is_bot === true && u.app_id).map((u) => String(u!.app_id)))];
}

/** The apps whose unfurl domains take a link (the manifest's `features.unfurl_domains`). */
function unfurling(ctx: WriteHookContext, url: string): string[] {
  let host = '';
  try { host = new URL(url).hostname; } catch { return []; }
  return ctx.rowsRaw('app').filter((a) => {
    const domains = (((a.manifest as Row | undefined)?.features as Row | undefined)?.unfurl_domains as string[] | undefined) ?? [];
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  }).map((a) => String(a.id));
}

/** The event. */
export function data(ctx: WriteHookContext, write: EventWrite, type: string): Record<string, unknown> {
  const r = storedSubject(ctx, write);
  const at = String(Math.floor(Date.parse(write.occurredAt) / 1000));
  const channelOf = (id: unknown): Row | undefined => ctx.row('channel', String(id ?? ''));
  switch (write.operation) {
    case 'message.create': {
      // the vendor's fields alone (ctx.own): the kernel's bookkeeping (its updatedAt, type and id) is never Slack's event
      const { channel, deleted: _d, ...m } = Object.fromEntries(Object.entries(ctx.own(r)).filter(([k]) => !k.startsWith('_')));
      // app_mention: "Subscribe to only the message events that mention your app or bot"
      if (type === 'app_mention') return { type: 'app_mention', user: m.user, text: m.text, ts: m.ts, channel, event_ts: m.ts, ...(m.thread_ts ? { thread_ts: m.thread_ts } : {}), ...(m.blocks ? { blocks: m.blocks } : {}) };
      return { ...m, type: 'message', channel, event_ts: m.ts, channel_type: eventChannelType(channelOf(channel)) };
    }
    case 'channel.create': return { type: 'channel_created', channel: { id: r.id, name: r.name, created: r.created, creator: r.creator }, event_ts: at };
    case 'channel.archive': return { type: 'channel_archive', channel: r.id, user: r.archived_by, event_ts: at };
    case 'channel.rename': return { type: 'channel_rename', channel: { id: r.id, name: r.name, created: r.created }, event_ts: at };
    case 'channel.join': {
      const c = channelOf(r._channel);
      return { type: 'member_joined_channel', user: r._user, channel: r._channel, channel_type: c?.is_private === true ? 'G' : 'C', team: c?.team_id, event_ts: at };
    }
    case 'reaction.add': case 'reaction.remove':
      return { type: write.operation === 'reaction.add' ? 'reaction_added' : 'reaction_removed', user: r.user, reaction: r.reaction, item_user: r.item_user, item: r.item, event_ts: at };
    case 'pin.add': return { type: 'pin_added', user: r.created_by, channel_id: r.channel, item: { type: 'message', channel: r.channel, message: shown(ctx.row('message', String(r._message))) }, event_ts: at };
    case 'user.join': return { type: 'team_join', user: { id: r.id, ...Object.fromEntries(Object.entries(ctx.own(r)).filter(([k]) => !k.startsWith('_') && k !== 'deleted')) }, event_ts: at };
    case 'home.open': return { type: 'app_home_opened', user: r.user, channel: r.channel, tab: 'home', event_ts: at };
    case 'link.share': return { type: 'link_shared', channel: r.channel, user: r.user, message_ts: r.message_ts, unfurl_id: r.id, source: 'conversations_history', links: r.links, event_ts: at };
    case 'app.uninstall': return { type: 'app_uninstalled', event_ts: at };
    case 'token.revoke': return { type: 'tokens_revoked', tokens: r.kind === 'bot' ? { bot: [r.bot ?? r.user] } : { oauth: [r.user] }, event_ts: at };
    default: return { type: write.operation, event_ts: at };
  }
}

/** The envelope's workspace, and for an event about one app the apps it goes to (`$apps`); a message that mentions no
 *  app sends no app_mention. */
export function values(ctx: WriteHookContext, write: EventWrite, type: string): Record<string, unknown> {
  const r = storedSubject(ctx, write);
  const team = (r.team as string | undefined) ?? (r.team_id as string | undefined) ?? (ctx.row('channel', String(r.channel ?? r._channel ?? ''))?.team_id as string | undefined) ?? HOME_TEAM;
  const channel = String(r.channel ?? r._channel ?? '');
  if (type === 'message') {
    // source: https://docs.slack.dev/reference/events/message.channels/ "A message was posted to a channel"
    const kind = eventChannelType(ctx.row('channel', channel));
    const family = kind === 'channel' ? 'channels' : kind === 'group' ? 'groups' : kind;
    return { $team: team, $subscription: `message.${family}`, $apps: installedApps(ctx, team, channel, `${family}:history`) };
  }
  if (type === 'app_mention') {
    const live = new Set(installedApps(ctx, team, channel, 'app_mentions:read'));
    const apps = mentioned(ctx, r.text).filter((app) => live.has(app));
    return apps.length ? { $team: team, $apps: apps } : { $team: team, $send: false };
  }
  if (type === 'app_uninstalled' || type === 'tokens_revoked') return { $team: team, $apps: [String(r.app ?? '')] };
  if (type === 'app_home_opened') return { $team: team, $apps: installedApps(ctx, team).filter((app) => app === String(r.app ?? '')) };
  if (type === 'link_shared') {
    const live = new Set(installedApps(ctx, team, channel, 'links:read'));
    return { $team: team, $apps: [...new Set(((r.links as Row[] | undefined) ?? []).flatMap((l) => unfurling(ctx, String(l.url))))].filter((app) => live.has(app)) };
  }
  return { $team: team, $installedApps: installedApps(ctx, team) };
}

/** The bot user an app has where it is installed (a workspace, or the whole org), made at its first install there: its
 *  name the manifest's bot display name. */
export async function botFor(ctx: HandlerContext, app: Row, team: string): Promise<{ user: string; bot: string }> {
  const held = ctx.rowsRaw('user').find((u) => u.is_bot === true && u.app_id === app.id && (u.install_team ?? null) === team);
  if (held) return { user: String(held.id), bot: String(held.bot_id) };
  const manifest = app.manifest as Row;
  const display = String(((manifest.features as Row | undefined)?.bot_user as Row | undefined)?.display_name ?? appName(manifest).toLowerCase().replace(/\s+/g, '_'));
  const bot = ctx.mint('bot');
  const user = ctx.mint('user');
  await ctx.write('user', user, {
    name: display, is_bot: true, bot_id: bot, app_id: app.id, install_team: team, team_id: team, deleted: false,
    profile: { real_name: appName(manifest), display_name: display, bot_id: bot }, updated: now(ctx),
  }, 'user.bot');
  if (team) await addToTeam(ctx, team, user);
  return { user, bot };
}
