// Slack's Socket Mode (the manifest's socket `socketMode`, the kernel's sockets.ts): an app's WebSocket, which "replaces
// the public Request URL that Slack would have sent payloads to" (https://docs.slack.dev/apis/events-api/using-socket-mode).
// The app opens it at the URL apps.connections.open answered, with that answer's ticket; it is sent `hello`, then each
// event its subscriptions take, in the Events API's envelope wrapped as `events_api`, and the slash commands and
// interactions the doors ask it (shared.ts askAppSocket), each acknowledged by its `envelope_id`. An app with several
// connections is sent each payload on one of them.
import type { EventWrite, HandlerContext, SocketEngine, SocketSession, WriteHookContext } from '@volter/world-core';
import { APP_EVENTS, data, SLACK_EVENTS, SOCKET_TICKETS, values } from './shared.ts';

type Row = Record<string, unknown>;
/** A connection's app, the ticket it opened with (the World's own draw: apps.ts apps_connections_open) and how many
 *  events it was sent. */
type Session = { app?: string; ticket?: string; sent: number };
const state = (s: SocketSession): Session => s.state as Session;

/** A subscription list taking an event type: every type when it names none, as the kernel's endpoints read it. */
const takes = (list: unknown, type: string): boolean => !Array.isArray(list) || list.length === 0 || list.includes(type);

async function open(s: SocketSession, ctx: HandlerContext): Promise<void> {
  const url = new URL(ctx.call.request.url);
  const ticket = url.searchParams.get('ticket') ?? '';
  const held = ctx.row(SOCKET_TICKETS, ticket);
  // Where the documentation stops: Slack does not say how it answers a spent or unknown ticket; the twin closes the
  // connection as a policy violation, and the client opens a new one with a fresh apps.connections.open
  if (!held || held.opened) return s.close(1008, 'invalid ticket');
  await ctx.record(SOCKET_TICKETS, { app: held.app, team: held.team, issued: held.issued, opened: ctx.occurredAt }, ticket);
  Object.assign(state(s), { app: String(held.app), ticket, sent: 0 });
  const mine = ctx.sockets('socketMode').filter((x) => x.state.app === held.app);
  // source: https://docs.slack.dev/apis/events-api/using-socket-mode "After you connect to the WebSocket, Slack will send a hello message"
  // its debug_info names the host the connection landed on, an applink host; where the documentation stops (the page's
  // example elides the rest of the name), the World's one host is applink-0volter01
  // source: https://docs.slack.dev/apis/events-api/using-socket-mode "applink-"
  s.send({ type: 'hello', num_connections: mine.length, debug_info: { host: 'applink-0volter01', started: ctx.occurredAt.replace('T', ' ').replace('Z', ''), build_number: 1, approximate_connection_time: 3600 }, connection_info: { app_id: held.app } });
}

/** The app's acknowledgement of a payload (`{envelope_id, payload?}`) settles what asked it. */
function message(s: SocketSession, frame: string): void {
  let ack: Row;
  try { ack = JSON.parse(frame) as Row; } catch { return; }
  if (typeof ack.envelope_id === 'string') s.fulfil(ack.envelope_id, ack);
}

/** The events a write sends this connection's app, by the same subscriptions its Request URL would take them by
 *  (shared.ts SLACK_EVENTS' endpoints), on the app's first open connection. */
async function write(s: SocketSession, w: EventWrite, ctx: HandlerContext): Promise<void> {
  const st = state(s);
  if (!st.app) return;
  const first = ctx.sockets('socketMode').filter((x) => x.state.app === st.app).sort((a, b) => a.id - b.id)[0];
  if (first?.id !== s.id) return;
  const app = ctx.row('app', st.app);
  if (!app || app.deleted === true) return;
  const subscribed = (((app.manifest as Row).settings as Row | undefined)?.event_subscriptions as Row | undefined)?.bot_events;
  const sent = SLACK_EVENTS.types?.[w.operation];
  const hook = ctx as unknown as WriteHookContext;
  for (const type of (Array.isArray(sent) ? sent : sent ? [sent] : []) as string[]) {
    const v = values(hook, w, type);
    if (v.$send === false) continue;
    const apps = (type === 'message' || APP_EVENTS.includes(type) ? v.$apps : v.$installedApps) as string[] | undefined;
    if (!apps?.includes(st.app)) continue;
    if (type === 'message' ? !(Array.isArray(subscribed) && subscribed.includes(v.$subscription)) : !takes(subscribed, type)) continue;
    st.sent += 1;
    const seconds = Math.floor(Date.parse(w.occurredAt) / 1000);
    // the connection is named by its ticket, which the World drew, never by the session's number, which counts the
    // process's connections and so differs between two Worlds walking the same steps
    const id = ctx.crypto.digest('sha256', `${st.app}|${type}|${w.occurredAt}|${String(st.ticket)}|${st.sent}`, 'hex');
    // source: https://docs.slack.dev/apis/events-api/using-socket-mode "Event payloads sent to your app via Socket Mode are identical to the typical Events API payloads"
    s.send({
      envelope_id: ctx.crypto.uuidFrom(id), type: 'events_api', accepts_response_payload: false, retry_attempt: 0, retry_reason: '',
      payload: {
        token: (app.credentials as Row).verification_token, team_id: v.$team, api_app_id: st.app, event: data(hook, w, type), type: 'event_callback',
        event_id: `Ev${id.slice(0, 10).toUpperCase()}`, event_time: seconds, authorizations: [],
      },
    });
  }
}

export const socketMode: SocketEngine<HandlerContext> = { open, message: (s, frame) => message(s, frame), write };
