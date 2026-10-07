// Slack's conversations.* methods (https://docs.slack.dev/reference/methods?family=conversations): channels, private
// channels and DMs, their members (one `channel_member` subject each), the messages and threads they hold, and Slack
// Connect invitations to people outside the workspace.
import type { HandlerContext } from '@volter/world-core';
import { listArg, nameRefusal, page } from '../engine/wire.ts';
import { channelTeam, addMember, arg, channelMembers, channelNamed, channelView, fail, messageId, messagesIn, messageView, now, ok, removeMember, sees, sendMail, systemMessage, teamView, userView, who, type Caller } from './shared.ts';

type Row = Record<string, unknown>;

/** The conversation a call names by `channel`, when the caller may see it ("channel_not_found: Value passed for
 *  channel was invalid", each method's Errors). */
function named(ctx: HandlerContext, by: Caller): Row | Response {
  const c = channelNamed(ctx, arg(ctx, 'channel'), by.team);
  return c && sees(ctx, c, by) ? c : fail(ctx, 'channel_not_found');
}

const flag = (v: unknown): boolean => v === true || v === 'true';

/** A conversation as a rename or an invite answers it: with its member count and locale, as the spec's examples of
 *  both give them. */
const counted = (ctx: HandlerContext, view: Row): Row => ({ ...view, num_members: channelMembers(ctx, String(view.id)).length, locale: 'en-US' });

/** conversations.create: "Initiates a public or private channel-based conversation". The creator is its first member;
 *  a name the workspace already has is `name_taken`, and one Slack's rules refuse its own error (engine/wire.ts). An org
 *  token names the workspace with `team_id` ("Encoded team id to create the channel in, required if org token is
 *  used"). */
export async function conversations_create(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const name = (arg(ctx, 'name') ?? '').trim();
  const refused = nameRefusal(name);
  if (refused) return fail(ctx, refused);
  const team = by.enterprise ? arg(ctx, 'team_id') ?? by.team : by.team;
  if (ctx.rowsRaw('channel').some((c) => c.name === name && channelTeam(c) === team)) return fail(ctx, 'name_taken');
  const at = now(ctx);
  const id = ctx.mint('channel');
  const c = await ctx.write('channel', id, {
    name, context_team_id: team, is_private: flag(ctx.params.is_private), created: at, updated: at * 1000, creator: by.user, is_archived: false, is_general: false,
    topic: { value: '', creator: '', last_set: 0 }, purpose: { value: '', creator: '', last_set: 0 },
  }, 'channel.create');
  await addMember(ctx, id, by.user);
  await systemMessage(ctx, c, by.user, 'channel_join');
  // a channel just made has nothing its creator has not read
  // source: spec:/paths/~1conversations.create/post/responses/200/examples/application~1json/channel "unread_count_display"
  return ok(ctx, { channel: { ...channelView(ctx, c, by), latest: null, unread_count: 0, unread_count_display: 0 } });
}

/** conversations.info: the conversation, with its member count and its locale when asked ("include_num_members …
 *  Defaults to `false`", "include_locale … Defaults to `false`"). */
// source: spec:/paths/~1conversations.info/get/parameters/3 "include_num_members"
export async function conversations_info(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = named(ctx, by);
  if (c instanceof Response) return c;
  return ok(ctx, { channel: { ...channelView(ctx, c, by), ...(flag(ctx.params.include_num_members) ? { num_members: channelMembers(ctx, String(c.id)).length } : {}), ...(flag(ctx.params.include_locale) ? { locale: 'en-US' } : {}) } });
}

/** conversations.join: "Joins an existing conversation" — a public channel only ("method_not_supported_for_channel_type"
 *  for a private one or a DM); one archived is `is_archived`; one the caller is in answers the channel with
 *  `already_in_channel` as its warning. */
export async function conversations_join(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = named(ctx, by);
  if (c instanceof Response) return c;
  if (c.is_private === true || c.is_im === true) return fail(ctx, 'method_not_supported_for_channel_type');
  if (c.is_archived === true) return fail(ctx, 'is_archived');
  if (channelMembers(ctx, String(c.id)).includes(by.user)) return ok(ctx, { channel: channelView(ctx, c, by), warning: 'already_in_channel', response_metadata: { warnings: ['already_in_channel'] } });
  await addMember(ctx, String(c.id), by.user);
  await systemMessage(ctx, c, by.user, 'channel_join');
  return ok(ctx, { channel: channelView(ctx, c, by) });
}

/** conversations.invite: "Invites users to a channel" — by a member of it ("not_in_channel"); each named user must
 *  exist ("user_not_found"), not be the caller ("cant_invite_self"), and one already in is `already_in_channel` when
 *  every user named is. An archived channel takes no one (`is_archived`). */
export async function conversations_invite(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = named(ctx, by);
  if (c instanceof Response) return c;
  // source: https://docs.slack.dev/reference/methods/conversations.invite "method_not_supported_for_channel_type"
  if (c.is_im === true) return fail(ctx, 'method_not_supported_for_channel_type');
  if (c.is_archived === true) return fail(ctx, 'is_archived');
  const members = channelMembers(ctx, String(c.id));
  if (!members.includes(by.user)) return fail(ctx, 'not_in_channel');
  const users = listArg(ctx.params.users);
  if (users.length === 0) return fail(ctx, 'no_user');
  if (users.includes(by.user)) return fail(ctx, 'cant_invite_self');
  for (const u of users) if (!ctx.get('user', u)) return fail(ctx, 'user_not_found');
  const added = users.filter((u) => !members.includes(u));
  if (added.length === 0) return fail(ctx, 'already_in_channel');
  for (const u of added) { await addMember(ctx, String(c.id), u); await systemMessage(ctx, c, u, 'channel_join', { inviter: by.user }); }
  // source: spec:/paths/~1conversations.invite/post/responses/200/examples/application~1json/channel "num_members"
  return ok(ctx, { channel: counted(ctx, channelView(ctx, ctx.row('channel', String(c.id))!, by)) });
}

/** conversations.leave: "Leaves a conversation"; one the caller is not in answers `not_in_channel` as a warning. */
export async function conversations_leave(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = named(ctx, by);
  if (c instanceof Response) return c;
  // source: https://docs.slack.dev/reference/methods/conversations.leave "cant_leave_general"
  if (c.is_general === true) return fail(ctx, 'cant_leave_general');
  if (!channelMembers(ctx, String(c.id)).includes(by.user)) return ok(ctx, { not_in_channel: true });
  await removeMember(ctx, String(c.id), by.user);
  return ok(ctx);
}

/** conversations.members: its members, a page at a time. */
export async function conversations_members(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = named(ctx, by);
  if (c instanceof Response) return c;
  const p = page(channelMembers(ctx, String(c.id)), ctx.params, 100);
  if (!p) return fail(ctx, 'invalid_cursor');
  return ok(ctx, { members: p.items, response_metadata: { next_cursor: p.next } });
}

/** conversations.list: the conversations the caller can see, of the types asked (`types`, "Mix and match channel types
 *  … public_channel, private_channel, mpim, im", public_channel when none), `exclude_archived` leaving archived ones out;
 *  an org token names a workspace with `team_id`. */
export async function conversations_list(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const types = listArg(ctx.params.types);
  const want = new Set(types.length ? types : ['public_channel']);
  const team = arg(ctx, 'team_id') ?? by.team;
  const typeOf = (c: Row): string => (c.is_im === true ? 'im' : c.is_mpim === true ? 'mpim' : c.is_private === true ? 'private_channel' : 'public_channel');
  const all = ctx.rowsRaw('channel').filter((c) => want.has(typeOf(c)) && (c.is_im === true || channelTeam(c) === team) && sees(ctx, c, by) && !(flag(ctx.params.exclude_archived) && c.is_archived === true));
  const p = page(all, ctx.params, 100);
  if (!p) return fail(ctx, 'invalid_cursor');
  // a listed channel carries its member count (the spec's conversations.list example)
  return ok(ctx, { channels: p.items.map((c) => ({ ...channelView(ctx, c, by), num_members: channelMembers(ctx, String(c.id)).length })), response_metadata: { next_cursor: p.next } });
}

/** conversations.history: a conversation's messages, newest first — the top of each thread and nothing of its replies
 *  but those also sent to the channel — between `oldest` and `latest`, a page at a time (`has_more`). */
export async function conversations_history(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = named(ctx, by);
  if (c instanceof Response) return c;
  const latest = arg(ctx, 'latest');
  const oldest = arg(ctx, 'oldest');
  const inclusive = flag(ctx.params.inclusive);
  const inRange = (ts: number): boolean => (latest === undefined || (inclusive ? ts <= Number(latest) : ts < Number(latest))) && (oldest === undefined || (inclusive ? ts >= Number(oldest) : ts > Number(oldest)));
  const top = messagesIn(ctx, String(c.id)).filter((m) => (!m.thread_ts || m.thread_ts === m.ts || m.subtype === 'thread_broadcast') && inRange(Number(m.ts))).reverse();
  const p = page(top, ctx.params, 100, 999);
  if (!p) return fail(ctx, 'invalid_cursor');
  const pins = ctx.rowsRaw('pin').filter((x) => x.channel === c.id).length;
  return ok(ctx, {
    messages: p.items.map((m) => messageView(ctx, m)), has_more: p.next !== '', pin_count: pins, channel_actions_ts: null, channel_actions_count: 0,
    response_metadata: { next_cursor: p.next },
  });
}

/** conversations.replies: a thread — its parent then its replies, oldest first ("thread_not_found" for a ts no message
 *  of the channel has). */
export async function conversations_replies(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = named(ctx, by);
  if (c instanceof Response) return c;
  const ts = arg(ctx, 'ts');
  const parent = ts ? ctx.get('message', messageId(String(c.id), ts)) : undefined;
  if (!parent || parent.deleted === true) return fail(ctx, 'thread_not_found');
  const root = typeof parent.thread_ts === 'string' ? parent.thread_ts : parent.ts;
  const thread = messagesIn(ctx, String(c.id)).filter((m) => m.ts === root || m.thread_ts === root);
  const p = page(thread, ctx.params, 1000);
  if (!p) return fail(ctx, 'invalid_cursor');
  // the parent names what the thread is to the caller: whether they follow it (a thread's author and repliers do), the
  // reply they read up to (the twin keeps no thread read marker: the parent) and the replies after it others sent
  // source: spec:/paths/~1conversations.replies/get/responses/200/examples/application~1json/messages/0 "subscribed"
  const replies = thread.filter((m) => m.ts !== root);
  const subscribed = [thread.find((m) => m.ts === root)?.user, ...replies.map((m) => m.user)].includes(by.user);
  const following = (m: Record<string, unknown>): Record<string, unknown> => m.ts !== root ? messageView(ctx, m)
    : { ...messageView(ctx, m), subscribed, last_read: root, unread_count: replies.filter((r) => String(r.ts) > String(root) && r.user !== by.user).length };
  return ok(ctx, { messages: p.items.map(following), has_more: p.next !== '', response_metadata: { next_cursor: p.next } });
}

/** conversations.open: a DM with one person, or a group DM with several ("Opens or resumes a direct message or
 *  multi-person direct message"); an existing one is resumed. Answers its id, or the whole conversation with
 *  `return_im`. */
export async function conversations_open(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const existing = arg(ctx, 'channel');
  if (existing) {
    const c = ctx.row('channel', existing);
    return c && channelMembers(ctx, String(c.id)).includes(by.user) ? ok(ctx, { channel: { id: c.id } }) : fail(ctx, 'channel_not_found');
  }
  const users = listArg(ctx.params.users);
  if (users.length === 0) return fail(ctx, 'users_list_not_supplied');
  for (const u of users) if (!ctx.get('user', u)) return fail(ctx, 'user_not_found');
  const people = [...new Set([by.user, ...users])].sort();
  const same = (c: Row): boolean => { const m = channelMembers(ctx, String(c.id)).sort(); return m.length === people.length && m.every((x, i) => x === people[i]); };
  const found = ctx.rowsRaw('channel').find((c) => (c.is_im === true || c.is_mpim === true) && same(c));
  const returnIm = flag(ctx.params.return_im);
  if (found) return ok(ctx, { no_op: true, already_open: true, channel: returnIm ? channelView(ctx, found, by) : { id: found.id } });
  const mpim = people.length > 2;
  const at = now(ctx);
  const id = ctx.mint(mpim ? 'channel' : 'im');
  const c = await ctx.write(mpim ? 'channel' : 'im', id, {
    ...(mpim ? { name: `mpdm-${people.join('--')}-1`, is_mpim: true, is_private: true } : { is_im: true }),
    context_team_id: by.team, created: at, updated: at * 1000, creator: by.user, is_archived: false,
  }, mpim ? 'channel.create' : 'im.open');
  for (const p of people) await addMember(ctx, id, p, mpim ? 'channel.join' : 'im.member');
  return ok(ctx, { channel: returnIm ? channelView(ctx, ctx.row('channel', id) ?? c, by) : { id } });
}

/** conversations.archive: "Archives a conversation" — not the workspace's general channel ("cant_archive_general"),
 *  and one already archived is `already_archived` (./states.ts). */
export async function conversations_archive(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = named(ctx, by);
  if (c instanceof Response) return c;
  if (c.is_general === true) return fail(ctx, 'cant_archive_general');
  const refused = ctx.legal('channel', 'is_archived', 'conversations_archive', String(c.is_archived === true), 'true', String(c.id));
  if (refused) return ctx.refuse(refused);
  await ctx.write('channel', String(c.id), { is_archived: true, archived_by: by.user, updated: now(ctx) * 1000 }, 'channel.archive');
  return ok(ctx);
}

/** conversations.unarchive: "Reverses conversation archival"; one not archived is `not_archived` (./states.ts). */
export async function conversations_unarchive(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = named(ctx, by);
  if (c instanceof Response) return c;
  const refused = ctx.legal('channel', 'is_archived', 'conversations_unarchive', String(c.is_archived === true), 'false', String(c.id));
  if (refused) return ctx.refuse(refused);
  await ctx.write('channel', String(c.id), { is_archived: false, updated: now(ctx) * 1000 }, 'channel.unarchive');
  return ok(ctx);
}

/** conversations.rename: a new name, under the same rules as a new channel's; its earlier names (`previous_names`) are
 *  read from the channel's own history (channelView). */
export async function conversations_rename(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = named(ctx, by);
  if (c instanceof Response) return c;
  // source: https://docs.slack.dev/reference/methods/conversations.rename "not_in_channel"
  if (!channelMembers(ctx, String(c.id)).includes(by.user)) return fail(ctx, 'not_in_channel');
  const name = (arg(ctx, 'name') ?? '').trim();
  const refused = nameRefusal(name);
  if (refused) return fail(ctx, refused);
  if (ctx.rowsRaw('channel').some((x) => x.name === name && channelTeam(x) === channelTeam(c) && x.id !== c.id)) return fail(ctx, 'name_taken');
  const old = String(c.name);
  await ctx.write('channel', String(c.id), { name }, 'channel.rename');
  await systemMessage(ctx, c, by.user, 'channel_name', { old_name: old, name });
  // source: spec:/paths/~1conversations.rename/post/responses/200/examples/application~1json/channel "locale"
  return ok(ctx, { channel: counted(ctx, channelView(ctx, ctx.row('channel', String(c.id))!, by)) });
}

/** Set a channel's topic or purpose: `{value, creator, last_set}`, by a member ("not_in_channel"). */
async function describe(ctx: HandlerContext, field: 'topic' | 'purpose'): Promise<Response> {
  const by = who(ctx);
  const c = named(ctx, by);
  if (c instanceof Response) return c;
  if (c.is_archived === true) return fail(ctx, 'is_archived');
  if (c.is_im !== true && !channelMembers(ctx, String(c.id)).includes(by.user)) return fail(ctx, 'not_in_channel');
  const value = arg(ctx, field) ?? '';
  await ctx.write('channel', String(c.id), { [field]: { value, creator: by.user, last_set: now(ctx) } }, `channel.${field}`);
  await systemMessage(ctx, c, by.user, field === 'topic' ? 'channel_topic' : 'channel_purpose', { [field]: value });
  return ok(ctx, { channel: channelView(ctx, ctx.row('channel', String(c.id))!, by) });
}

/** conversations.setPurpose. */
export async function conversations_setPurpose(ctx: HandlerContext): Promise<Response> {
  return describe(ctx, 'purpose');
}

/** conversations.setTopic. */
export async function conversations_setTopic(ctx: HandlerContext): Promise<Response> {
  return describe(ctx, 'topic');
}

/** conversations.mark: the caller's read position in a conversation, kept on their membership. */
export async function conversations_mark(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = named(ctx, by);
  if (c instanceof Response) return c;
  const ts = arg(ctx, 'ts');
  if (!ts) return fail(ctx, 'invalid_timestamp');
  if (!channelMembers(ctx, String(c.id)).includes(by.user)) return fail(ctx, 'not_in_channel');
  await ctx.write('channel_member', `${String(c.id)}::${by.user}`, { last_read: ts }, 'channel.mark');
  return ok(ctx);
}

/** Recipient-specific Connect invitations; acceptance belongs to the receiving workspace, outside this demand. */
export async function conversations_inviteShared(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = named(ctx, by);
  if (c instanceof Response) return c;
  // source: https://docs.slack.dev/reference/methods/conversations.inviteShared "channel_archived"
  if (c.is_archived === true) return fail(ctx, 'channel_archived');
  // source: https://docs.slack.dev/reference/methods/conversations.inviteShared "cannot_share_mandatory_channel"
  if (c.is_general === true) return fail(ctx, 'cannot_share_mandatory_channel');
  // source: https://docs.slack.dev/reference/methods/conversations.inviteShared "invalid_channel_type"
  if (c.is_im === true || c.is_mpim === true) return fail(ctx, 'invalid_channel_type');
  // source: https://docs.slack.dev/reference/methods/conversations.inviteShared "not_in_channel"
  if (!channelMembers(ctx, String(c.id)).includes(by.user)) return fail(ctx, 'not_in_channel');
  // The SDK JSON-encodes array arguments in a form; JSON callers supply the arrays directly.
  const recipients = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value !== 'string') return [];
    try { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed)) return parsed.map(String); } catch {}
    return listArg(value);
  };
  const emails = recipients(ctx.params.emails), users = recipients(ctx.params.user_ids);
  // source: https://docs.slack.dev/reference/methods/conversations.inviteShared "too_many_emails"
  if (emails.length > 1) return fail(ctx, 'too_many_emails');
  // source: https://docs.slack.dev/reference/methods/conversations.inviteShared "invalid_arguments"
  if (users.length > 1 || (emails.length && users.length)) return fail(ctx, 'invalid_arguments');
  // source: https://docs.slack.dev/reference/methods/conversations.inviteShared "recipients_not_specified"
  if (!emails.length && !users.length) return fail(ctx, by.kind === 'bot' ? 'recipients_not_specified' : 'restricted_action');
  if (users.length) {
    // source: https://docs.slack.dev/reference/methods/conversations.inviteShared "user_not_found"
    if (!ctx.get('user', users[0]!)) return fail(ctx, 'user_not_found');
    // source: https://docs.slack.dev/reference/methods/conversations.inviteShared "already_in_channel"
    if (channelMembers(ctx, String(c.id)).includes(users[0]!)) return fail(ctx, 'already_in_channel');
    // A known external recipient requires another workspace's shared identity. That setup is not in this pack's demand.
    return ctx.gap();
  }
  const email = emails[0]!.trim().toLowerCase();
  // source: https://docs.slack.dev/reference/methods/conversations.inviteShared "invalid_email"
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(ctx, 'invalid_email');
  // source: https://docs.slack.dev/reference/methods/conversations.inviteShared "connection_limit_exceeded_pending"
  if (ctx.rowsRaw('connect_invite').some((row) => (row.channel as Row)?.id === c.id && Number((row.invite as Row)?.date_invalid) > now(ctx))) return fail(ctx, 'connection_limit_exceeded_pending');
  const at = now(ctx), id = ctx.mint('connect_invite');
  const team = ctx.get('team', by.team)!, user = ctx.get('user', by.user)!;
  const workspace = teamView(team), person = userView(ctx, user, by.team);
  const invite = {
    id, date_created: at,
    // source: https://trailhead.salesforce.com/content/learn/modules/slack-connect/use-slack-to-work-with-people-outside-your-organization "it expires after 14 days"
    date_invalid: at + 14 * 24 * 60 * 60,
    inviting_team: { id: workspace.id, name: workspace.name, icon: workspace.icon, domain: workspace.domain, date_created: team.created },
    inviting_user: { id: person.id, team_id: person.team_id, name: person.name, updated: person.updated, profile: person.profile },
  };
  // source: https://docs.slack.dev/reference/methods/conversations.listConnectInvites "outgoing"
  await ctx.write('connect_invite', id, {
    direction: 'outgoing', status: 'sent', date_last_updated: at, invite_type: 'channel', invite,
    channel: { id: c.id, is_private: c.is_private === true, is_im: false, name: c.name }, acceptances: [],
    _team: by.team, _recipient: email, _external_limited: ctx.params.external_limited === undefined || flag(ctx.params.external_limited),
  }, 'connect_invite.create');
  ctx.legal('channel', 'is_ext_shared', 'conversations_inviteShared', c.is_ext_shared ?? false, 'true', String(c.id));
  await ctx.write('channel', String(c.id), { is_ext_shared: true }, 'channel.connect');
  // Mail is retained in the local outbox only. The receiving workspace's join URL and approval flow are not simulated.
  await sendMail(ctx, email, `Invitation to ${String(c.name)} in Slack`, `A Slack Connect invitation ${id} from ${String(team.name)} is pending.`, []);
  // Recipient-specific invitations do not disclose a shareable URL or conf_code.
  // source: https://docs.slack.dev/reference/methods/conversations.inviteShared "recipient-specific"
  return ok(ctx, { invite_id: id, is_legacy_shared_channel: false });
}

/** Pending outgoing channel invitations for the caller workspace, with the vendor's count/cursor wire. */
export async function conversations_listConnectInvites(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx), team = arg(ctx, 'team_id') ?? by.team;
  if (team !== by.team) return fail(ctx, 'team_access_not_granted');
  const count = ctx.params.count === undefined ? 100 : Number(ctx.params.count);
  // source: https://docs.slack.dev/reference/methods/conversations.listConnectInvites "invalid_arguments"
  if (!Number.isInteger(count) || count < 1) return fail(ctx, 'invalid_arguments');
  const rows = ctx.rowsRaw('connect_invite').filter((row) => (row._team ?? ((row.invite as Row)?.inviting_team as Row)?.id) === team && Number((row.invite as Row)?.date_invalid) > now(ctx));
  const selected = page(rows.map((row) => {
    const { _team, _recipient, _external_limited, ...invitation } = ctx.own(row);
    return invitation;
  }), { ...ctx.params, limit: count }, 100, Number.MAX_SAFE_INTEGER);
  if (!selected) return fail(ctx, 'invalid_arguments');
  return ok(ctx, { invites: selected.items, response_metadata: { next_cursor: selected.next } });
}
