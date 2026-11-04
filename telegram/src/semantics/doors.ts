// The World's doors (architecture, "Doors, screens and the gap"): what people do in the Telegram app and in BotFather,
// which no Bot API method does, each declared in the manifest's `doors` and answered here by the export its id names.
// A person signs up, makes a bot (and its token again), makes a chat, adds, promotes or removes a member, and writes a
// message; what a bot is told of it is the update each write puts in its queue, as the Bot API would deliver it.
import type { HandlerContext } from '@volter/world-core';
import { finish } from '../engine/text.ts';
import {
  chatFullView, chatOf, findChat, issueToken, memberKey, memberView, messageView, nextMessageId, queueUpdate, recipientsOf, storeFile, unixOf, userView,
  type Row,
} from './shared.ts';

export type { HandlerContext };

const bad = (error: string, status = 400): Response => Response.json({ error }, { status });
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : undefined);
const userByName = (ctx: HandlerContext, name: string): Row | undefined =>
  ctx.rowsRaw('user').find((u) => u.deleted !== true && typeof u.username === 'string' && u.username.toLowerCase() === name.replace(/^@/, '').toLowerCase());

/** A Telegram account, as a person signs up in the app. */
export async function people(ctx: HandlerContext): Promise<Response> {
  const first = str(ctx.params.first_name);
  if (!first) return bad('first_name is required');
  const username = str(ctx.params.username)?.replace(/^@/, '');
  // source: https://core.telegram.org/bots/api#user "Optional. User's or bot's username"
  if (username && userByName(ctx, username)) return bad(`the username ${username} is taken`, 409);
  const row = await ctx.create('user', (id) => ({
    id: Number(id), is_bot: false, first_name: first,
    ...(str(ctx.params.last_name) ? { last_name: str(ctx.params.last_name) } : {}),
    ...(username ? { username, _username: username.toLowerCase() } : {}),
    ...(str(ctx.params.language_code) ? { language_code: str(ctx.params.language_code) } : {}),
  }), 'people');
  return Response.json(userView(ctx, (row as Row).id ?? ctx.own(row as Row).id));
}

/** A metadata-issued bot belongs to the first member's Telegram person. */
async function applicationBot(ctx: HandlerContext): Promise<Response> {
  const owner = await ctx.tenant('user', async (world) => {
    const email = world.members[0]!.toLowerCase();
    const existing = ctx.rowsRaw('user').find((row) => row.is_bot !== true && row._email === email);
    return existing ? String(existing.id) : String((await ctx.create('user', (id) => ({
      id: Number(id), is_bot: false, first_name: world.label, _email: email,
    }), 'people')).id);
  });
  const organization = await ctx.account();
  const bot = await ctx.deploymentObject(`bot:${owner.id}`, 'user', async (deployment) => {
    const explicit = str(ctx.params.username)?.replace(/^@/, '');
    const label = (explicit ?? deployment) || 'world_twin';
    const base = label.replace(/_?bot$/i, '') || 'world';
    const identity = deployment ? `${organization}/${deployment}` : organization;
    for (const suffixed of [false, true]) {
      const username = explicit && !suffixed && /^[A-Za-z0-9_]{5,32}$/.test(explicit) && /bot$/i.test(explicit) ? explicit
        : `${ctx.vendorName(base, { max: 28, lower: true, allowed: /[a-z0-9_]/, separator: '_' }, { suffixed, identity })}_bot`;
      if (userByName(ctx, username)) continue;
      const made = await ctx.createUnique('user', (id) => ({ id: Number(id), is_bot: true,
        first_name: str(ctx.params.name) ?? (deployment || 'World Twin Bot'), username, _username: username.toLowerCase(),
        can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false,
        has_main_web_app: false, has_topics_enabled: false }), 'bots');
      if (made.created) {
        const id = String(made.row.id);
        await ctx.record('_bot', { owner: owner.id, generation: 1, update_seq: 836_000_000 }, id);
        return id;
      }
    }
    throw bad(`A bot username already exists for ${identity}.`, 409);
  });
  const key = await ctx.accountKey(`bot-token:${bot.id}`, '_bot', {
    make: async () => {
      const id = String(bot.id);
      const before = ctx.row('_bot', id);
      if (!before) {
        const retired = ctx.row('_bot', id, { withDeleted: true });
        const generation = Number(retired?.generation ?? 0) + 1;
        const token = await issueToken(ctx, id, generation);
        await ctx.createUnique('_bot', {
          id, owner: owner.id, generation, token_sha256: ctx.crypto.sha256(token),
          update_seq: retired?.update_seq ?? 836_000_000, deleted: false, _pending: false,
        }, 'bot.token', { id, input: 'omit' });
        return id;
      }
      const current = await issueToken(ctx, String(bot.id), Number(before.generation ?? 1));
      if (before.token_sha256 === ctx.crypto.sha256(current)) return String(bot.id);
      await ctx.change('_bot', String(bot.id), (row) => row._pending === true || row.token_sha256 !== before.token_sha256 ? undefined
        : { generation: row.token_sha256 === undefined ? Number(row.generation ?? 1) : Number(row.generation ?? 1) + 1, _pending: true }, 'bot.token.reserve');
      const native = ctx.row('_bot', String(bot.id))!;
      const token = await issueToken(ctx, String(bot.id), Number(native.generation));
      await ctx.change('_bot', String(bot.id), (row) => row.generation === native.generation
        ? { token_sha256: ctx.crypto.sha256(token), _pending: false } : undefined, 'bot.token');
      return String(bot.id);
    },
    read: async (row) => {
      if (row.owner !== owner.id || row._pending === true) return undefined;
      const token = await issueToken(ctx, String(bot.id), Number(row.generation));
      return row.token_sha256 === ctx.crypto.sha256(token) ? token : undefined;
    },
  });
  return Response.json({ id: Number(bot.id), name: bot.first_name, username: bot.username, token: key.secret });
}

/** BotFather's /newbot: a bot (its name, its username ending in "bot") and its token; the same username answers the
 *  bot made before and its token as it stands, so a World's credential door answers the same token at every boot. */
export async function bots(ctx: HandlerContext): Promise<Response> {
  const body = ctx.body && typeof ctx.body === 'object' ? ctx.body as Row : {};
  if (body.account !== undefined || body.deployment !== undefined) {
    try { return await applicationBot(ctx); } catch (error) { if (error instanceof Response) return error; throw error; }
  }
  // source: https://core.telegram.org/bots/features#botfather "Usernames are 5-32 characters long and not case sensitive – but may only include Latin characters, numbers, and underscores. Your bot's username must end in 'bot’, like 'tetris_bot' or 'TetrisBot'."
  const username = (str(ctx.params.username) ?? 'world_twin_bot').replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username) || !/bot$/i.test(username)) return bad('Sorry, this username is invalid.');
  const name = str(ctx.params.name) ?? 'World Twin Bot';
  const owner = num(ctx.params.owner);
  if (owner !== undefined && !ctx.row('user', String(owner))) return bad(`no person ${owner}`, 404);
  const held = userByName(ctx, username);
  if (held) return heldBot(ctx, held);
  // a bot's own fields, which getMe alone returns: it joins groups, privacy mode is on, and it offers nothing it
  // was not set up for
  // source: https://core.telegram.org/bots/features#privacy-mode "Privacy mode is enabled by default for all bots"
  const row = await ctx.create('user', (id) => ({
    id: Number(id), is_bot: true, first_name: name, username, _username: username.toLowerCase(),
    can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false,
    has_main_web_app: false, has_topics_enabled: false,
  }), 'bots');
  const id = String((row as Row).id ?? ctx.own(row as Row).id);
  const token = await issueToken(ctx, id, 1);
  await ctx.record('_bot', { owner: owner ?? null, generation: 1, token_sha256: ctx.crypto.sha256(token), update_seq: 836_000_000 }, id);
  return Response.json({ id: Number(id), name, username, token });
}

/** The bot a username already names, and its token as it stands (a World's credential door asked again at a boot). */
async function heldBot(ctx: HandlerContext, held: Row): Promise<Response> {
  if (held.is_bot !== true) return bad('Sorry, this username is already taken.', 409);
  const bot = ctx.row('_bot', String(held.id))!;
  return Response.json({ id: Number(ctx.own(held).id), name: held.first_name, username: held.username, token: await issueToken(ctx, String(held.id), Number(bot.generation ?? 1)) });
}

/** BotFather's /token: a new token for the bot; the one before stops working. */
// source: https://core.telegram.org/bots/features#botfather "If your existing token is compromised or you lost it for some reason, use the /token command to generate a new one."
export async function botToken(ctx: HandlerContext): Promise<Response> {
  const held = userByName(ctx, String(ctx.call.params.username ?? ''));
  if (!held || held.is_bot !== true) return bad('no such bot', 404);
  const id = String(held.id);
  const bot = ctx.row('_bot', id)!;
  const owner = num(ctx.params.owner);
  if (bot.owner !== null && bot.owner !== undefined && owner !== Number(bot.owner)) return bad('only the bot\'s owner makes its token', 403);
  const generation = Number(bot.generation ?? 1) + 1;
  const token = await issueToken(ctx, id, generation);
  await ctx.record('_bot', { generation, token_sha256: ctx.crypto.sha256(token) }, id);
  return Response.json({ id: Number(ctx.own(held).id), username: held.username, token });
}

/** Default administrator rights for a member made an administrator in the app, as the app proposes them, with what
 *  the door's `rights` says. */
function adminRights(type: string, rights: Row): Row {
  const base: Row = {
    can_be_edited: false, is_anonymous: false, can_manage_chat: true, can_delete_messages: false, can_manage_video_chats: false,
    can_restrict_members: false, can_promote_members: false, can_change_info: false, can_invite_users: true,
    can_post_stories: false, can_edit_stories: false, can_delete_stories: false, can_send_welcome_messages: false,
    ...(type === 'channel' ? { can_post_messages: false, can_edit_messages: false } : { can_pin_messages: false }),
  };
  for (const [k, v] of Object.entries(rights)) if (k in base && typeof v === 'boolean') base[k] = v;
  return base;
}

/** A member's status moved by a person in the app (the machine allows it), its rights kept, and a bot told of its own
 *  move (my_chat_member). */
async function moveMember(ctx: HandlerContext, chat: Row, by: number, user: number, to: string, rights: Row, operation: string): Promise<Row | Response> {
  const key = memberKey(chat.id, user);
  const prior = ctx.row('chat_member', key);
  const current = prior && prior.deleted !== true ? String(prior.status) : 'left';
  const refused = ctx.legal('chat_member', 'status', operation, current, to, key, 'external');
  if (refused) return bad(refused.message, refused.status);
  const before = memberView(ctx, prior, user);
  const fields: Row = { _chat: chat.id, _user: user, status: to };
  if (to === 'administrator') Object.assign(fields, adminRights(String(chat.type), rights));
  // source: https://core.telegram.org/bots/api#chatmemberowner "Represents a chat member that owns the chat and has all administrator privileges."
  if (to === 'creator') Object.assign(fields, { is_anonymous: false });
  // source: https://core.telegram.org/bots/api#chatmemberbanned "If 0, then the user is banned forever"
  if (to === 'kicked') Object.assign(fields, { until_date: 0 });
  await ctx.write('chat_member', key, fields, operation);
  const after = ctx.row('chat_member', key)!;
  if (ctx.row('user', String(user))?.is_bot === true && user !== by) {
    // source: https://core.telegram.org/bots/api#update "Optional. The bot's chat member status was updated in a chat."
    await queueUpdate(ctx, user, 'my_chat_member', { chat: chatViewOf(ctx, chat), from: userView(ctx, by), date: unixOf(ctx.occurredAt), old_chat_member: before, new_chat_member: memberView(ctx, after, user) }, operation);
  }
  return after;
}

const chatViewOf = (ctx: HandlerContext, chat: Row): Row =>
  Object.fromEntries(Object.entries(chatFullView(ctx, chat)).filter(([k]) => ['id', 'type', 'title', 'username', 'first_name', 'last_name'].includes(k)));

/** A message a person (or the app, for a service message) writes in a chat, kept and delivered to the bots it reaches. */
async function post(ctx: HandlerContext, chat: Row, fields: Row, from: number | undefined, operation: string, extra: Row = {}): Promise<Row> {
  const chatKey = String(chat.id);
  const messageId = await nextMessageId(ctx, chatKey, operation);
  const key = `${chatKey}:${messageId}`;
  const channel = chat.type === 'channel';
  await ctx.write('message', key, {
    message_id: messageId, date: unixOf(ctx.occurredAt), ...fields,
    _chat: chat.id,
    // source: https://core.telegram.org/bots/api#message "Optional. Sender of the message when sent on behalf of a chat. For example, the supergroup itself for messages sent by its anonymous administrators or a linked channel for messages automatically forwarded to the channel's discussion group."
    ...(channel ? { _sender_chat: chat.id } : from !== undefined ? { _from: from } : {}),
    ...extra,
  }, operation);
  const row = ctx.row('message', key)!;
  // source: https://core.telegram.org/bots/api#update "Optional. New incoming channel post of any kind - text, photo, sticker, etc."
  const type = channel ? 'channel_post' : 'message';
  for (const bot of recipientsOf(ctx, chatOf(ctx, chatKey)!, row)) await queueUpdate(ctx, bot, type, messageView(ctx, row), operation);
  return row;
}

/** A chat a person makes in the app: a group, a supergroup or a channel, its creator its owner, its members added, and
 *  the service message that it was made. */
export async function chats(ctx: HandlerContext): Promise<Response> {
  const creator = num(ctx.params.creator);
  if (creator === undefined || ctx.row('user', String(creator))?.is_bot !== false) return bad('creator must be a person (a user id)');
  const type = str(ctx.params.type);
  if (!type || !['group', 'supergroup', 'channel'].includes(type)) return bad('type is group, supergroup or channel');
  const title = str(ctx.params.title);
  if (!title) return bad('title is required');
  const username = str(ctx.params.username)?.replace(/^@/, '');
  if (username && (ctx.rowsRaw('chat').some((c) => c.deleted !== true && String(c.username ?? '').toLowerCase() === username.toLowerCase()) || userByName(ctx, username))) return bad(`the username ${username} is taken`, 409);
  if (username && type === 'group') return bad('a basic group has no username; make it a supergroup');
  const id = await ctx.issue(type === 'group' ? '_group' : '_channel');
  const operation = 'chats';
  let photo: Row | undefined;
  const photoData = str(ctx.params.photo);
  if (photoData) {
    const bytes = Uint8Array.from(atob(photoData), (c) => c.charCodeAt(0));
    // a chat photo in its two sizes, each its own file
    // source: https://core.telegram.org/bots/api#chatphoto "File identifier of small (160x160) chat photo."
    const small = await storeFile(ctx, bytes, { kind: 'profile_photos', mime: 'image/jpeg' }, operation);
    const big = await storeFile(ctx, bytes, { kind: 'profile_photos', mime: 'image/jpeg' }, operation);
    photo = { small_file_id: small.file_id, small_file_unique_id: small.file_unique_id, big_file_id: big.file_id, big_file_unique_id: big.file_unique_id };
  }
  const n = Math.abs(Number(id));
  await ctx.write('chat', id, {
    id: Number(id), type, title,
    ...(username ? { username, active_usernames: [username] } : {}),
    ...(photo ? { photo } : {}),
    ...(str(ctx.params.description) ? { description: str(ctx.params.description) } : {}),
    // Where the documentation stops: a chat's own accent color, reaction count and accepted gifts until someone sets
    // them; the page names the colors 0-6 a theme customizes, and the twin takes the id's remainder by 7
    // source: https://core.telegram.org/bots/api#accent-colors "Colors with identifiers 0 (red), 1 (orange), 2 (purple/violet), 3 (green), 4 (cyan), 5 (blue), 6 (pink) can be customized by app themes."
    accent_color_id: n % 7,
    max_reaction_count: 11,
    accepted_gift_types: { unlimited_gifts: false, limited_gifts: false, unique_gifts: false, premium_subscription: false, gifts_from_channels: false },
  }, operation);
  const chat = (): Row => chatOf(ctx, id)!;
  const own = await moveMember(ctx, chat(), creator, creator, 'creator', {}, operation);
  if (own instanceof Response) return own;
  for (const m of (Array.isArray(ctx.params.members) ? ctx.params.members : []) as Row[]) {
    const user = num(m.user);
    if (user === undefined || !ctx.row('user', String(user))) return bad(`no user ${String(m.user)}`, 404);
    const to = m.status === 'administrator' ? 'administrator' : 'member';
    const moved = await moveMember(ctx, chat(), creator, user, to, (m.rights ?? {}) as Row, operation);
    if (moved instanceof Response) return moved;
  }
  // source: https://core.telegram.org/bots/api#message "Optional. Service message: the group has been created"
  const created = type === 'group' ? { group_chat_created: true } : type === 'supergroup' ? { supergroup_chat_created: true } : { channel_chat_created: true };
  await post(ctx, chat(), created, creator, operation);
  return Response.json(chatFullView(ctx, chat()));
}

/** A person adds a member to a chat, promotes one, or removes one (kicked); a group is told by a service message who
 *  joined or was removed. */
export async function members(ctx: HandlerContext): Promise<Response> {
  const chat = chatOf(ctx, String(ctx.call.params.chat_id ?? ''));
  if (!chat || chat.deleted === true || chat.type === 'private') return bad('no such group or channel', 404);
  const by = num(ctx.params.by);
  const user = num(ctx.params.user);
  if (by === undefined || user === undefined || !ctx.row('user', String(by)) || !ctx.row('user', String(user))) return bad('by and user are user ids');
  const to = str(ctx.params.status);
  if (!to || !['member', 'administrator', 'kicked'].includes(to)) return bad('status is member, administrator or kicked');
  // a person adds, promotes or removes a member only as an administrator of the chat
  const actor = ctx.row('chat_member', memberKey(chat.id, by));
  if (!actor || !['creator', 'administrator'].includes(String(actor.status))) return bad('only an administrator of the chat does that', 403);
  const prior = ctx.row('chat_member', memberKey(chat.id, user));
  const was = String(prior?.status ?? 'left');
  // what the app does not offer: making a member what it already is, or demoting an administrator (not served)
  if (was === to || (was === 'creator') || (to === 'member' && was === 'administrator')) return bad(`the member is ${was}`, 409);
  const operation = 'members';
  const moved = await moveMember(ctx, chat, by, user, to, (ctx.params.rights ?? {}) as Row, operation);
  if (moved instanceof Response) return moved;
  if (chat.type !== 'channel') {
    // source: https://core.telegram.org/bots/api#message "Optional. New members that were added to the group or supergroup and information about them (the bot itself may be one of these members)"
    if ((to === 'member' || to === 'administrator') && !['member', 'administrator', 'creator'].includes(was)) await post(ctx, chatOf(ctx, chat.id)!, {}, by, operation, { _new_members: [user] });
    // source: https://core.telegram.org/bots/api#message "Optional. A member was removed from the group, information about them (this member may be the bot itself)"
    if (to === 'kicked' && ['member', 'administrator'].includes(was)) await post(ctx, chatOf(ctx, chat.id)!, { left_chat_member: userView(ctx, user) }, by, operation);
  }
  return Response.json(memberView(ctx, moved, user));
}

/** A person writes a message in the app: in a group or a channel they are in, or to a bot (its @username) in private,
 *  which starts the bot for them. The app marks what the text holds (mentions, commands, links) as the server does. */
export async function messages(ctx: HandlerContext): Promise<Response> {
  const from = num(ctx.params.from);
  const person = from === undefined ? undefined : ctx.row('user', String(from));
  if (!person || person.is_bot !== false) return bad('from must be a person (a user id)');
  const text = typeof ctx.params.text === 'string' ? ctx.params.text : '';
  if (!text.trim()) return bad('text is required');
  const target = ctx.params.chat;
  const operation = 'messages';
  let chat: Row | undefined;
  let extra: Row = {};
  const bot = typeof target === 'string' && target.startsWith('@') ? userByName(ctx, target) : undefined;
  if (bot && bot.is_bot === true) {
    // a private chat is the person's own id, as a bot sees it
    // source: https://core.telegram.org/bots/api#chat "Unique identifier for this chat."
    const key = String(from);
    if (!ctx.row('chat', key)) {
      await ctx.write('chat', key, {
        id: from, type: 'private', first_name: person.first_name,
        ...(person.last_name ? { last_name: person.last_name } : {}), ...(person.username ? { username: person.username } : {}),
        accent_color_id: Math.abs(Number(from)) % 7, max_reaction_count: 11,
        accepted_gift_types: { unlimited_gifts: false, limited_gifts: false, unique_gifts: false, premium_subscription: false, gifts_from_channels: false },
      }, operation);
    }
    // writing to a bot starts it: from now on it may write to the person
    // source: https://core.telegram.org/bots/features#botfather "Users will see a Start button the first time they open a chat with your bot."
    // (a private chat's start sends the bot no my_chat_member: that is only for a block or an unblock)
    // source: https://core.telegram.org/bots/api#update "For private chats, this update is received only when the bot is blocked or unblocked by the user."
    const member = ctx.row('chat_member', memberKey(key, bot.id));
    if (!member || member.status !== 'member') {
      const refused = ctx.legal('chat_member', 'status', operation, String(member?.status ?? 'left'), 'member', memberKey(key, bot.id), 'external');
      if (refused) return bad(refused.message, refused.status);
      await ctx.write('chat_member', memberKey(key, bot.id), { _chat: from, _user: Number(bot.id), status: 'member' }, operation);
    }
    chat = chatOf(ctx, key)!;
    extra = { _with: Number(bot.id) };
  } else {
    chat = num(target) !== undefined ? chatOf(ctx, num(target)) : typeof target === 'string' ? findChat(ctx, target) : undefined;
    if (!chat || chat.type === 'private') return bad('no such chat', 404);
    const member = ctx.row('chat_member', memberKey(chat.id, from));
    const status = String(member?.status ?? 'left');
    if (!['creator', 'administrator', 'member'].includes(status)) return bad('the person is not a member of the chat', 403);
    if (chat.type === 'channel' && !['creator', 'administrator'].includes(status)) return bad('only administrators post in a channel', 403);
  }
  const reply = num(ctx.params.reply_to_message_id);
  if (reply !== undefined && !ctx.row('message', `${chat.id}:${reply}`)) return bad('no such message to reply to', 404);
  const formattedText = finish({ text, entities: [] }, { find: true, skipBotCommands: false });
  const row = await post(ctx, chat, { text: formattedText.text, ...(formattedText.entities.length ? { entities: formattedText.entities } : {}) }, from, operation, {
    ...extra, ...(reply !== undefined ? { _reply_to: `${chat.id}:${reply}` } : {}),
  });
  return Response.json(messageView(ctx, row));
}
