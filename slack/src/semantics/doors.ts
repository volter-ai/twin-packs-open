// The World's doors (the manifest's `doors`): what stands in for acts outside Slack's API and pages.
import type { HandlerContext } from '@volter/world-core';
import { commandsOf } from '../engine/app-manifest.ts';
import { allScopes } from '../engine/methods.ts';
import { HOME_TEAM } from '../engine/wire.ts';
import { caller, channelMembers, channelNamed, DELIVERIES, EVENT_DELIVERIES, MAIL, botFor, keepToken, makeApp, makeWorkspace, SLACK_EVENTS, messageId, tokenKey, now, replyAsApp, RESPONSE_URLS, askApp, askAppSocket, sees, serial, socketMode, shareLinks, shown, TOKENS, type Caller } from './shared.ts';

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
  if (!channel || !sees(ctx, channel, by)) return Response.json({ ok: false, error: 'channel_not_found' }, { status: 404 });
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
  if (!app || !ctx.row('app_install', `${String(app.id)}::${by.team}`)) return Response.json({ ok: false, error: 'app_not_found' }, { status: 404 });
  const bot = ctx.rowsRaw('user').find((u) => u.is_bot === true && u.app_id === app.id && u.install_team === by.team);
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
  if (!channel || !sees(ctx, channel, by) || !m) return Response.json({ ok: false, error: 'message_not_found' }, { status: 404 });
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
  if (!channel || !sees(ctx, channel, by) || !m) return Response.json({ ok: false, error: 'message_not_found' }, { status: 404 });
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

/** Slack's app-delivery outbox (`?to=<url>`), newest first: commands, interactions and declared events, including
 *  queued or rejected deliveries, with their native outcomes. Each event's body is its payload. */
export async function deliveries(ctx: HandlerContext): Promise<Response> {
  const to = new URL(ctx.call.request.url).searchParams.get('to');
  // an interaction is sent as the one form field `payload`, its JSON ("a payload parameter",
  // https://docs.slack.dev/interactivity/handling-user-interaction): what the app reads is that interaction
  const interaction = (p: unknown): unknown => { const o = p as Record<string, unknown> | undefined; return o && typeof o === 'object' && Object.keys(o).length === 1 && o.payload && typeof o.payload === 'object' ? o.payload : p; };
  const asked = ctx.rowsRaw(DELIVERIES).map((d) => ({ to: String(d.to), payload: interaction(d.payload), sent: Number(d.sent), status: d.status, missed: d.missed }));
  const events = ctx.rowsRaw(EVENT_DELIVERIES).map((d) => { let payload: unknown = d.body; try { payload = JSON.parse(String(d.body)); } catch { /* sent as recorded */ } return { to: String(d.url), payload, sent: Math.floor(Number(d.sent_at) / 1000), status: d.transport_status ?? null, delivery_state: d.delivery_state ?? null, accepted_at: d.accepted_at ?? null }; });
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

/** A retained token's native wire value; its issue number, never its secret, is stored on the token row. */
async function appTokenValue(ctx: HandlerContext, kind: 'bot' | 'app', app: string, issuance: string): Promise<string> {
  const d = ctx.crypto.digest('sha256', await ctx.secret(`world-app:${kind}:${app}:${issuance}`), 'hex');
  return kind === 'bot'
    ? `xoxb-${String(BigInt(`0x${d.slice(0, 10)}`))}-${String(BigInt(`0x${d.slice(10, 20)}`))}-${d.slice(20, 44)}`
    : `xapp-1-${app}-${String(BigInt(`0x${d.slice(0, 10)}`))}-${d.slice(10, 74)}`;
}

/** A deployment's developer app and installation, with the workspace's grants and app-specific Socket Mode tokens. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  try {
    const workspace = await ctx.tenant('team', async org => {
      if (org.id === 'default' && ctx.row('team', HOME_TEAM)) return HOME_TEAM;
      const email = org.members[0]!.toLowerCase();
      const label = org.id === 'default' ? 'world' : org.label;
      const rule = { max: 21, lower: true, allowed: /[a-z0-9-]/ };
      const create = (suffixed: boolean) => makeWorkspace(ctx, org.id === 'default' ? HOME_TEAM : undefined, { email, name: email.split('@')[0]! }, {
        name: org.label, domain: ctx.vendorName(label, rule, { suffixed, identity: org.id }),
      });
      const made = await create(false) ?? await create(true);
      if (!made) throw Response.json({ ok: false, error: 'url_taken', response_metadata: { messages: [`This workspace URL is already in use (${org.id}).`] } });
      return made.team;
    });
    const team = String(workspace.id);
    const app = await ctx.deploymentObject(`app:${team}`, 'app', async deployment => String((await makeApp(ctx, {
      display_information: { name: deployment || 'World app' },
      features: { bot_user: { display_name: 'world', always_online: true } },
      settings: { socket_mode_enabled: true, event_subscriptions: { bot_events: WORLD_APP_EVENTS } },
    }, { team, creator: String(workspace.created_by) })).id));
    await ctx.deploymentObject(`installation:${String(app.id)}`, 'app_install', async () => {
      const id = `${String(app.id)}::${team}`;
      await ctx.write('app_install', id, { team, app: app.id, installed_by: workspace.created_by, at: now(ctx), deleted: false }, 'app.install');
      return id;
    });
    const { user, bot } = await botFor(ctx, app, team);
    const token = async (kind: 'bot' | 'app'): Promise<string> => (await ctx.accountKey(`${kind}-token`, TOKENS, {
      make: async () => {
        const issuance = await serial(ctx, `${kind}_token`);
        const value = await appTokenValue(ctx, kind, String(app.id), issuance);
        await keepToken(ctx, value, {
          app: app.id, team, _world_issue: issuance,
          ...(kind === 'bot' ? { user, bot, scopes: worldAppScopes() } : { scopes: ['connections:write'], name: 'world' }),
        });
        return tokenKey(value);
      },
      read: async row => {
        if (row.app !== app.id || row.team !== team || row.kind !== kind || typeof row._world_issue !== 'string' || !ctx.row('app_install', `${String(app.id)}::${team}`)) return undefined;
        const value = await appTokenValue(ctx, kind, String(app.id), row._world_issue);
        return tokenKey(value) === row.id && !('error' in caller(ctx, value)) ? value : undefined;
      },
    })).secret;
    const botToken = await token('bot');
    const appToken = await token('app');
    const credentials = app.credentials as Row;
    return Response.json({ ok: true, app_id: app.id, bot_user_id: user, bot_token: botToken, app_token: appToken, signing_secret: credentials.signing_secret, client_id: credentials.client_id, client_secret: credentials.client_secret }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
