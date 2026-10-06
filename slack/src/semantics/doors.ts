// The World's doors (the manifest's `doors`): what stands in for acts outside Slack's API and pages.
import type { HandlerContext } from '@volter/world-core';
import { commandsOf } from '../engine/app-manifest.ts';
import { allScopes } from '../engine/methods.ts';
import { HOME_TEAM } from '../engine/wire.ts';
import { caller, channelMembers, channelNamed, DELIVERIES, EVENT_DELIVERIES, MAIL, botFor, keepToken, makeApp, SLACK_EVENTS, messageId, tokenKey, now, replyAsApp, RESPONSE_URLS, askApp, askAppSocket, serial, socketMode, shareLinks, shown, TOKENS, type Caller } from './shared.ts';

type Row = Record<string, unknown>;

/** An app another workspace made from its manifest and distributed publicly: the World holds no workspace but its
 *  own, so the app's maker states it here, and keeps its credentials (201). */
export async function apps(ctx: HandlerContext): Promise<Response> {
  const workspace = typeof ctx.params.workspace === 'string' ? ctx.params.workspace : 'Elsewhere';
  const manifest = ctx.params.manifest;
  if (!manifest || typeof manifest !== 'object') return Response.json({ ok: false, error: 'invalid_manifest' }, { status: 400 });
  const app = await makeApp(ctx, manifest as Row, { team: `W-${workspace}`, made_in: workspace, distributed: true });
  return Response.json({ ok: true, app_id: app.id, credentials: app.credentials }, { status: 201 });
}

/** A person runs a slash command in the Slack client: the app installed in their workspace that declares the command
 *  is sent it at the command's URL, as Slack sends it ("the command, the text after it, and who ran it where",
 *  https://docs.slack.dev/interactivity/implementing-slash-commands#app_command_handling). */
export async function command(ctx: HandlerContext): Promise<Response> {
  const by = caller(ctx);
  if ('error' in by) return Response.json({ ok: false, error: by.error }, { status: 401 });
  const name = String(ctx.params.command ?? '');
  const text = String(ctx.params.text ?? '');
  const channel = channelNamed(ctx, String(ctx.params.channel ?? ''), by.team);
  if (!channel) return Response.json({ ok: false, error: 'channel_not_found' }, { status: 404 });
  const installed = new Set(ctx.rowsRaw(TOKENS).filter((t) => t.kind === 'bot' && t.revoked !== true && t.team === by.team).map((t) => t.app));
  const app = ctx.rowsRaw('app').find((a) => installed.has(a.id) && commandsOf(a.manifest as Row).some((c) => c.command === name));
  if (!app) return Response.json({ ok: false, error: 'command_not_found' }, { status: 404 });
  const declared = commandsOf(app.manifest as Row).find((c) => c.command === name)!;
  const team = ctx.get('team', by.team);
  const person = ctx.get('user', by.user);
  const credentials = app.credentials as Row;
  const trigger = `${now(ctx)}.${(await ctx.secret(`trigger:${await serial(ctx, 'trigger')}`)).slice(0, 16)}`;
  const payload = {
    token: credentials.verification_token, team_id: by.team, team_domain: team?.domain ?? '', enterprise_id: '', enterprise_name: '',
    channel_id: channel.id, channel_name: channel.name ?? 'directmessage', user_id: by.user, user_name: person?.name ?? by.user, command: name, text,
    api_app_id: app.id, is_enterprise_install: 'false', response_url: await responseUrl(ctx, 'commands', { team: by.team, channel: String(channel.id), user: by.user, app: String(app.id) }), trigger_id: trigger,
  };
  // a Socket Mode app is asked on its connection, not at the command's URL
  const to = socketMode(app) ? `socket:${String(app.id)}` : declared.url;
  const answer = socketMode(app) ? await askAppSocket(ctx, app, 'slash_commands', payload) : await askApp(ctx, declared.url, payload, String(credentials.signing_secret));
  return answer.missed ? Response.json({ ok: false, error: 'operation_timeout', delivered_to: to }) : acknowledged(ctx, answer, to, { app: String(app.id), team: by.team, channel: String(channel.id), user: by.user });
}

/** An app's server acknowledging a command: its body, when it has one, is the reply (JSON, or plain text shown to the
 *  person alone). */
async function acknowledged(ctx: HandlerContext, answer: { status: number; body: string }, url: string, f: { app: string; team: string; channel: string; user: string }): Promise<Response> {
  if (answer.status === 200 && answer.body.trim()) {
    let reply: Row;
    try { reply = JSON.parse(answer.body) as Row; } catch { reply = { text: answer.body }; }
    await replyAsApp(ctx, f, reply);
  }
  return Response.json({ ok: answer.status === 200, delivered_to: url, status: answer.status });
}

/** A `response_url` Slack hands an app with a command or an interaction: where it may answer, "up to 5 times within 30
 *  minutes" (https://docs.slack.dev/interactivity/handling-user-interaction#message_responses), kept as `_response_url`
 *  (../screens/response-url.ts answers it). */
async function responseUrl(ctx: HandlerContext, kind: 'commands' | 'actions', f: { team: string; channel: string; user: string; app: string; message_ts?: string }): Promise<string> {
  const key = ctx.crypto.digest('sha256', await ctx.secret(`response-url:${await serial(ctx, 'response_url')}`), 'hex').slice(0, 24);
  await ctx.record(RESPONSE_URLS, { ...f, kind, issued: now(ctx) }, key);
  return `https://hooks.slack.com/${kind}/${f.team}/${now(ctx)}/${key}`;
}

/** The person a door acts for (their client token), or Slack's refusal. */
function person(ctx: HandlerContext): Caller | Response {
  const by = caller(ctx);
  return 'error' in by ? Response.json({ ok: false, error: by.error }, { status: 401 }) : by;
}

/** A person opens an app's Home tab in the client: Slack sends the app `app_home_opened` (its DM with them as the
 *  channel), recorded as one `home_open` each (https://docs.slack.dev/reference/events/app_home_opened). */
export async function home(ctx: HandlerContext): Promise<Response> {
  const by = person(ctx);
  if (by instanceof Response) return by;
  const app = ctx.row('app', String(ctx.params.app ?? ''));
  if (!app) return Response.json({ ok: false, error: 'app_not_found' }, { status: 404 });
  const bot = ctx.rowsRaw('user').find((u) => u.is_bot === true && u.app_id === app.id);
  const dm = bot ? ctx.rowsRaw('channel').find((c) => c.is_im === true && channelMembers(ctx, String(c.id)).includes(by.user) && channelMembers(ctx, String(c.id)).includes(String(bot.id))) : undefined;
  const id = ctx.mint('home_open');
  await ctx.write('home_open', id, { user: by.user, app: app.id, channel: dm?.id ?? `D${String(app.id)}`, team: by.team, at: now(ctx) }, 'home.open');
  return Response.json({ ok: true }, { status: 201 });
}

/** A person's client reports the links their message shares: the `unfurl_id` of the share Slack made of it (shared.ts
 *  shareLinks). */
export async function link(ctx: HandlerContext): Promise<Response> {
  const by = person(ctx);
  if (by instanceof Response) return by;
  const channel = channelNamed(ctx, String(ctx.params.channel ?? ''), by.team);
  const ts = String(ctx.params.ts ?? '');
  const m = channel ? ctx.row('message', messageId(String(channel.id), ts)) : undefined;
  if (!channel || !m) return Response.json({ ok: false, error: 'message_not_found' }, { status: 404 });
  const share = await shareLinks(ctx, m);
  if (!share) return Response.json({ ok: false, error: 'no_links' }, { status: 400 });
  return Response.json({ ok: true, unfurl_id: share.id }, { status: 201 });
}

/** A person presses a button in an app's message: Slack posts the `block_actions` payload to the app's interactivity
 *  Request URL, signed, with a `response_url` to answer through
 *  (https://docs.slack.dev/reference/interaction-payloads/block_actions-payload). */
export async function action(ctx: HandlerContext): Promise<Response> {
  const by = person(ctx);
  if (by instanceof Response) return by;
  const channel = channelNamed(ctx, String(ctx.params.channel ?? ''), by.team);
  const ts = String(ctx.params.ts ?? '');
  const m = channel ? ctx.row('message', messageId(String(channel.id), ts)) : undefined;
  if (!channel || !m) return Response.json({ ok: false, error: 'message_not_found' }, { status: 404 });
  const actionId = String(ctx.params.action_id ?? '');
  const element = ((m.blocks as Row[] | undefined) ?? []).flatMap((b) => ((b.elements as Row[] | undefined) ?? []).map((e) => ({ block: b, e }))).find((x) => x.e.action_id === actionId);
  const app = m.app_id ? ctx.row('app', String(m.app_id)) : undefined;
  if (!element || !app) return Response.json({ ok: false, error: 'action_not_found' }, { status: 404 });
  const url = ((app.manifest as Row).settings as Row | undefined)?.interactivity as Row | undefined;
  // a Socket Mode app takes interactions on its connection once interactivity is on; any other at its Request URL
  if (socketMode(app) ? url?.is_enabled !== true : !url?.request_url) return Response.json({ ok: false, error: 'interactivity_not_enabled' }, { status: 409 });
  const team = ctx.get('team', by.team);
  const credentials = app.credentials as Row;
  const trigger = `${now(ctx)}.${(await ctx.secret(`trigger:${await serial(ctx, 'trigger')}`)).slice(0, 16)}`;
  const payload = {
    type: 'block_actions', user: { id: by.user, username: ctx.get('user', by.user)?.name ?? by.user, team_id: by.team }, api_app_id: app.id, token: credentials.verification_token,
    container: { type: 'message', message_ts: ts, channel_id: channel.id, is_ephemeral: false }, trigger_id: trigger, team: { id: by.team, domain: team?.domain ?? '' },
    enterprise: null, is_enterprise_install: false, channel: { id: channel.id, name: channel.name ?? 'directmessage' }, message: shown(m),
    response_url: await responseUrl(ctx, 'actions', { team: by.team, channel: String(channel.id), user: by.user, app: String(app.id), message_ts: ts }),
    actions: [{ action_id: actionId, block_id: element.block.block_id, text: element.e.text, value: element.e.value, type: element.e.type, action_ts: String(now(ctx)) }],
  };
  const to = socketMode(app) ? `socket:${String(app.id)}` : String(url!.request_url);
  const answer = socketMode(app) ? await askAppSocket(ctx, app, 'interactive', payload) : await askApp(ctx, to, { payload }, String(credentials.signing_secret));
  return Response.json({ ok: answer.status === 200 && !answer.missed, delivered_to: to, status: answer.status, ...(answer.missed ? { error: 'operation_timeout' } : {}) });
}

/** What Slack sent an app's server (`?to=<url>`), newest first: the commands and interactions it asked the app, and the
 *  events it sent it (each event's body its payload). */
export async function deliveries(ctx: HandlerContext): Promise<Response> {
  const to = new URL(ctx.call.request.url).searchParams.get('to');
  // an interaction is sent as the one form field `payload`, its JSON ("a payload parameter",
  // https://docs.slack.dev/interactivity/handling-user-interaction): what the app reads is that interaction
  const interaction = (p: unknown): unknown => { const o = p as Record<string, unknown> | undefined; return o && typeof o === 'object' && Object.keys(o).length === 1 && o.payload && typeof o.payload === 'object' ? o.payload : p; };
  const asked = ctx.rowsRaw(DELIVERIES).map((d) => ({ to: String(d.to), payload: interaction(d.payload), sent: Number(d.sent) }));
  const events = ctx.rowsRaw(EVENT_DELIVERIES).map((d) => { let payload: unknown = d.body; try { payload = JSON.parse(String(d.body)); } catch { /* sent as recorded */ } return { to: String(d.url), payload, sent: Math.floor(Number(d.sent_at) / 1000) }; });
  const all = [...asked, ...events].map((d, i) => ({ ...d, i })).filter((d) => !to || d.to === to).sort((a, b) => b.sent - a.sent || b.i - a.i);
  return Response.json({ deliveries: all.map(({ i: _i, ...d }) => d) });
}

/** A person's inbox (`?to=<address>`): the mail Slack sent them, newest first. */
export async function mail(ctx: HandlerContext): Promise<Response> {
  const to = (new URL(ctx.call.request.url).searchParams.get('to') ?? '').toLowerCase();
  return Response.json({ mail: ctx.rowsRaw(MAIL).filter((m) => !to || String(m.to).toLowerCase() === to).reverse().map((m) => ({ to: m.to, subject: m.subject, text: m.text, links: m.links, sent: m.sent })) });
}

/** The bot events the World's app is subscribed to: every event this twin sends (SLACK_EVENTS), a message as each of
 *  its subscriptions (https://docs.slack.dev/reference/events/message.channels and its kin). link_shared is left out:
 *  it reaches an app only on the unfurl domains it names, and the World's app names none. */
const WORLD_APP_EVENTS = [...new Set(Object.values(SLACK_EVENTS.types).flat().flatMap((t) => (t === 'message' ? ['message.channels', 'message.groups', 'message.im', 'message.mpim'] : t === 'link_shared' ? [] : [t])))].sort();
/** What the World's bot holds: every scope Slack's methods name, and the event and posting scopes, since a World has no
 *  install step where an app asks for its own. */
const worldAppScopes = (): string[] => [...new Set([...allScopes(), 'channels:history', 'groups:history', 'im:history', 'mpim:history', 'app_mentions:read', 'links:read', 'chat:write.public'])].sort();

/** POST /_twin/app-credentials: the credentials the World's application holds (the descriptor's credentialDoor). The
 *  World's own app, made the first time the runtime asks: installed in the World's workspace with its bot, in Socket
 *  Mode and subscribed to every bot event. It answers the bot token (`xoxb-`), an app-level token with
 *  `connections:write` (`xapp-`) and the app's signing secret and client credentials, the same at every boot (each
 *  drawn from the World's secret). An app a person removed, or whose tokens they revoked, is made again. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const draw = async (label: string, app: string): Promise<string> => ctx.crypto.digest('sha256', await ctx.secret(`world-app:${label}:${app}`), 'hex');
  const tokensOf = async (app: string): Promise<{ bot: string; app: string }> => {
    const b = await draw('bot', app);
    const a = await draw('app', app);
    return { bot: `xoxb-${String(BigInt(`0x${b.slice(0, 10)}`))}-${String(BigInt(`0x${b.slice(10, 20)}`))}-${b.slice(20, 44)}`, app: `xapp-1-${app}-${String(BigInt(`0x${a.slice(0, 10)}`))}-${a.slice(10, 74)}` };
  };
  // the World's app still standing: not removed, installed, its tokens not revoked
  let held: Row | undefined;
  for (const a of ctx.rowsRaw('app').filter((x) => x._world_app === true && x.deleted !== true)) {
    const t = await tokensOf(String(a.id));
    const install = ctx.row('app_install', `${String(a.id)}::${HOME_TEAM}`);
    if (install?.deleted === true || [t.bot, t.app].some((k) => ctx.row(TOKENS, tokenKey(k))?.revoked === true)) continue;
    held = a;
  }
  const app = held ?? await makeApp(ctx, {
    display_information: { name: 'World app' },
    features: { bot_user: { display_name: 'world', always_online: true } },
    settings: { socket_mode_enabled: true, event_subscriptions: { bot_events: WORLD_APP_EVENTS } },
  }, { team: HOME_TEAM });
  if (!held) await ctx.write('app', String(app.id), { _world_app: true }, 'app.update');
  const { user, bot } = await botFor(ctx, app, HOME_TEAM);
  const tokens = await tokensOf(String(app.id));
  if (!ctx.row(TOKENS, tokenKey(tokens.bot))) await keepToken(ctx, tokens.bot, { user, bot, app: app.id, scopes: worldAppScopes(), team: HOME_TEAM });
  if (!ctx.row(TOKENS, tokenKey(tokens.app))) await keepToken(ctx, tokens.app, { app: app.id, scopes: ['connections:write'], team: HOME_TEAM, name: 'world' });
  if (!ctx.row('app_install', `${String(app.id)}::${HOME_TEAM}`)) await ctx.write('app_install', `${String(app.id)}::${HOME_TEAM}`, { team: HOME_TEAM, app: app.id, installed_by: null, at: now(ctx), deleted: false }, 'app.install');
  const credentials = app.credentials as Row;
  return Response.json({ ok: true, app_id: app.id, bot_user_id: user, bot_token: tokens.bot, app_token: tokens.app, signing_secret: credentials.signing_secret, client_id: credentials.client_id, client_secret: credentials.client_secret }, { status: 201 });
}
