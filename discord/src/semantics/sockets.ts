// Discord's Gateway (the manifest's socket `gateway`, the kernel's sockets.ts): a bot's WebSocket. It is sent HELLO,
// heartbeats (ACK), identifies with its token and intents, and is sent READY and a GUILD_CREATE for each of its
// servers; after that, the writes of the World it is to hear of: messages made and edited (MESSAGE_CREATE and
// MESSAGE_UPDATE, content only under MESSAGE_CONTENT unless the message is its own or names it), threads made
// (THREAD_CREATE), reactions added and taken back (MESSAGE_REACTION_ADD and _REMOVE) and its joining a server
// (GUILD_CREATE), each in a channel it can see and under the intent the Gateway page names for it. A client finds it
// with GET /gateway/bot (discord.js), or dials Discord's own host for it (discord.py: the manifest's gateway.discord.gg).
// A dropped session is not resumed: RESUME is answered INVALID_SESSION, and the bot identifies again. The session start
// limit is counted (GET /gateway/bot) but not enforced: Discord's answer to the thousandth identify in a day is to end
// every session and reset the bot's token, which no application of the World reaches.
import type { EventWrite, HandlerContext, SocketEngine, SocketSession } from '@volter/world-core';
import { appView, arr, BOT_TOKEN, CHANNEL, channelPermissions, EPHEMERAL, gatewayUrl, GUILD, guildView, IDENTIFY, INTERACTION, interactionView, isThread, MEMBER, memberView, MESSAGE, messageView, obj, P, REACTION, type Row, sha256, USER, userView } from './shared.ts';

// source: https://docs.discord.com/developers/events/gateway "Example Hello Event"
const HEARTBEAT_INTERVAL = 41250;
// source: https://docs.discord.com/developers/events/gateway "GUILDS (1 << 0)"
// source: https://docs.discord.com/developers/events/gateway "GUILD_MESSAGE_REACTIONS (1 << 10)"
const I = { GUILDS: 1 << 0, GUILD_MEMBERS: 1 << 1, GUILD_PRESENCES: 1 << 8, GUILD_MESSAGES: 1 << 9, GUILD_MESSAGE_REACTIONS: 1 << 10, MESSAGE_CONTENT: 1 << 15 };
const PRIVILEGED: Record<number, string> = { [I.GUILD_MEMBERS]: 'guild_members', [I.GUILD_PRESENCES]: 'presences', [I.MESSAGE_CONTENT]: 'message_content' };
const ALL_INTENTS = (1 << 26) - 1;

type Session = { bot?: string; app?: string; intents?: number; seq: number };
const state = (s: SocketSession): Session => s.state as Session;

function dispatch(s: SocketSession, t: string, d: unknown): void {
  const st = state(s);
  st.seq += 1;
  s.send({ op: 0, t, s: st.seq, d });
}

/** A server as GUILD_CREATE sends it: the guild with its roles, and what the bot joined with (channels, threads and
 *  the bot itself; the World keeps no one in voice). */
function guildCreate(ctx: HandlerContext, guildId: string, bot: string): Row | undefined {
  const guild = ctx.row(GUILD, guildId);
  if (!guild || guild.deleted === true) return undefined;
  const all = (type: string): Row[] => ctx.rowsRaw(type).filter((r) => r.deleted !== true);
  const channels = all(CHANNEL).filter((c) => c.guild_id === guildId);
  const members = all(MEMBER).filter((m) => m._guild === guildId);
  // source: https://docs.discord.com/developers/events/gateway-events "members and presences returned in this event will only contain your bot and users in voice channels"
  const shown = members.filter((m) => m._user === bot);
  const me = members.find((m) => m._user === bot);
  return {
    ...guildView(ctx, guild), joined_at: me?.joined_at ?? null, large: false, unavailable: false, member_count: members.length,
    voice_states: [],
    members: shown.map((m) => memberView(ctx, m)), channels: channels.filter((c) => !isThread(ctx.own(c))).map((c) => ctx.get(CHANNEL, String(c.id))),
    threads: channels.filter((c) => isThread(ctx.own(c))).map((c) => ctx.get(CHANNEL, String(c.id))), presences: [], stage_instances: [], guild_scheduled_events: [], soundboard_sounds: [],
  };
}

async function identify(s: SocketSession, d: Row, ctx: HandlerContext): Promise<void> {
  const st = state(s);
  // source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "You sent more than one identify payload."
  if (st.bot) return s.close(4005, 'Already authenticated.');
  const token = String(d.token ?? '').replace(/^Bot\s+/i, '');
  const held = ctx.rowsRaw(BOT_TOKEN).find((t) => t.sha256 === sha256(ctx, token) && t.revoked !== true);
  const app = held ? ctx.row('application', String(held.application)) : undefined;
  // source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "Authentication failed"
  if (!app) return s.close(4004, 'Authentication failed.');
  const intents = Number(d.intents);
  // source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "Invalid intent(s)"
  if (!Number.isInteger(intents) || intents < 0 || intents > ALL_INTENTS) return s.close(4013, 'Invalid intent(s).');
  // source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "Disallowed intent(s)"
  const enabled = arr<string>(app._privileged_intents);
  if (Object.entries(PRIVILEGED).some(([bit, name]) => (intents & Number(bit)) !== 0 && !enabled.includes(name))) return s.close(4014, 'Disallowed intent(s).');
  const bot = String(app._bot);
  const id = ctx.mint(IDENTIFY);
  await ctx.record(IDENTIFY, { application: app.id, at: ctx.occurredAt }, id);
  Object.assign(st, { bot, app: String(app.id), intents });
  const user = ctx.row(USER, bot)!;
  const guilds = ctx.rowsRaw(MEMBER).filter((m) => m.deleted !== true && m._user === bot).map((m) => String(m._guild));
  // source: https://docs.discord.com/developers/events/gateway-events "The ready event is dispatched when a client has completed the initial handshake with the gateway"
  dispatch(s, 'READY', {
    v: 10, user: userView(user, { email: true }), user_settings: {}, private_channels: [], relationships: [], presences: [], guild_join_requests: [], geo_ordered_rtc_regions: ['us-east', 'us-central'],
    guilds: guilds.map((g) => ({ id: g, unavailable: true })), session_type: 'normal',
    session_id: sha256(ctx, `${await ctx.secret(`discord-session:${id}`)}`).slice(0, 32), resume_gateway_url: gatewayUrl(ctx),
    ...(Array.isArray(d.shard) ? { shard: d.shard } : {}), application: { id: app.id, flags: Number(appView(ctx, app).flags ?? 0) },
  });
  // source: https://docs.discord.com/developers/events/gateway-events "to lazily load and backfill information for all unavailable guilds sent in the"
  if (intents & I.GUILDS) for (const g of guilds) { const d2 = guildCreate(ctx, g, bot); if (d2) dispatch(s, 'GUILD_CREATE', d2); }
}

/** A message as the bot hears it: its content only under MESSAGE_CONTENT, or its own, or naming it. */
function messageFor(ctx: HandlerContext, m: Row, st: Session): Row {
  const view = messageView(ctx, m, st.bot);
  // source: https://docs.discord.com/developers/events/gateway "all contain message content and therefore require the intent"
  const sees = (st.intents! & I.MESSAGE_CONTENT) !== 0 || m._author === st.bot || arr<string>(m._mentions).includes(st.bot!);
  if (!sees) Object.assign(view, { content: '', embeds: [], attachments: [], components: [] });
  view.guild_id = m._guild;
  const member = m._author ? ctx.row(MEMBER, `${String(m._guild)}:${String(m._author)}`) : undefined;
  if (member) { const { user: _u, ...partial } = memberView(ctx, member); view.member = partial; }
  return view;
}

/** Whether the session's bot is in the guild and can see the channel: a bot hears only the channels it can see. */
function sees(ctx: HandlerContext, st: Session, guild: string, channelId: string): boolean {
  if (!ctx.row(MEMBER, `${guild}:${st.bot}`)) return false;
  const g = ctx.row(GUILD, guild);
  const channel = ctx.row(CHANNEL, channelId);
  return Boolean(g && channel && (channelPermissions(ctx, g, channel, st.bot!) & P.VIEW_CHANNEL) !== 0n);
}

async function write(s: SocketSession, w: EventWrite, ctx: HandlerContext): Promise<void> {
  const st = state(s);
  if (!st.bot) return;
  const intents = st.intents!;
  const body = w.body;
  // source: https://docs.discord.com/developers/events/gateway-events "Sent when a user uses an Application Command or Message Component"
  if (w.storedType === INTERACTION && w.operation === 'interaction.create') {
    const i = ctx.row(INTERACTION, String(body.id));
    if (i && i.application_id === st.app && sees(ctx, st, String(i.guild_id), String(i.channel_id))) dispatch(s, 'INTERACTION_CREATE', await interactionView(ctx, i));
    return;
  }
  if (w.storedType === MESSAGE && (w.operation === 'message.create' || w.operation === 'message.update')) {
    const m = ctx.row(MESSAGE, String(body.id));
    // source: https://docs.discord.com/developers/resources/message "this message is only visible to the user who invoked the Interaction"
    if (!m || (Number(m.flags) & EPHEMERAL) !== 0 || !(intents & I.GUILD_MESSAGES) || !sees(ctx, st, String(m._guild), String(m.channel_id))) return;
    if (w.operation === 'message.create') return dispatch(s, 'MESSAGE_CREATE', messageFor(ctx, m, st));
    // source: https://docs.discord.com/developers/events/gateway-events "The value for tts will always be false in message updates."
    return dispatch(s, 'MESSAGE_UPDATE', { ...messageFor(ctx, m, st), tts: false });
  }
  if (w.storedType === CHANNEL && w.operation === 'thread.create') {
    const thread = ctx.row(CHANNEL, String(body.id));
    if (!thread || !(intents & I.GUILDS) || !sees(ctx, st, String(thread.guild_id), String(thread.id))) return;
    // source: https://docs.discord.com/developers/events/gateway-events "When a thread is created, includes an additional newly_created boolean field."
    return dispatch(s, 'THREAD_CREATE', { ...ctx.get(CHANNEL, String(thread.id)), newly_created: true });
  }
  if (w.storedType === REACTION && (w.operation === 'reaction.add' || w.operation === 'reaction.remove')) {
    const r = ctx.row(REACTION, String(body.id), { withDeleted: true });
    if (!r || !(intents & I.GUILD_MESSAGE_REACTIONS) || !sees(ctx, st, String(r._guild), String(r._channel))) return;
    // source: https://docs.discord.com/developers/events/gateway-events "Sent when a user adds a reaction to a message."
    const d: Row = { user_id: r._user, channel_id: r._channel, message_id: r._message, guild_id: r._guild, emoji: r.emoji, burst: false, type: 0 };
    if (w.operation === 'reaction.remove') return dispatch(s, 'MESSAGE_REACTION_REMOVE', d);
    const member = ctx.row(MEMBER, `${String(r._guild)}:${String(r._user)}`);
    const message = ctx.row(MESSAGE, String(r._message), { withDeleted: true });
    return dispatch(s, 'MESSAGE_REACTION_ADD', { ...d, ...(member ? { member: memberView(ctx, member) } : {}), ...(message?._author ? { message_author_id: message._author } : {}), burst_colors: [] });
  }
  if (w.storedType === MEMBER && w.operation === 'member.add') {
    const m = ctx.row(MEMBER, String(body.id));
    if (m && m._user === st.bot && intents & I.GUILDS) { const d = guildCreate(ctx, String(m._guild), st.bot); if (d) dispatch(s, 'GUILD_CREATE', d); }
    return;
  }
}

export const gateway: SocketEngine<HandlerContext> = {
  open(s) {
    state(s).seq = 0;
    // source: https://docs.discord.com/developers/events/gateway "Once connected to the Gateway, your app will receive a"
    s.send({ op: 10, d: { heartbeat_interval: HEARTBEAT_INTERVAL }, s: null, t: null });
  },
  async message(s, data, ctx) {
    let frame: Row;
    try { frame = obj(JSON.parse(data)); } catch { return s.close(4002, 'Error while decoding payload.'); }
    const op = Number(frame.op);
    // source: https://docs.discord.com/developers/events/gateway "Discord will respond with a"
    if (op === 1) return s.send({ op: 11 });
    if (op === 2) return identify(s, obj(frame.d), ctx);
    // source: https://docs.discord.com/developers/events/gateway "If the d field is set to false"
    if (op === 6) return s.send({ op: 9, d: false, s: null, t: null });
    if (![3, 4, 8, 31].includes(op)) return s.close(4001, 'Unknown opcode.');
    // source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "You sent us a payload prior to"
    if (!state(s).bot) return s.close(4003, 'Not authenticated.');
    // a presence, a voice move, a member request or a soundboard request: none the World's applications send, and none it models
    return undefined;
  },
  write,
};
