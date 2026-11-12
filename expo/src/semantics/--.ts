// Sending pushes and reading their receipts. A ticket says Expo received a message for a recipient; the receipt, made
// when Expo hands it to FCM or APNs (semantics/clock.ts), says whether they took it.
import type { HandlerContext } from '@volter/world-core';
import { deviceOf, isPushToken, jsonBody, messageIssue, obj, NOTIFICATION, requestError, type Row } from './shared.ts';

// source: https://docs.expo.dev/push-notifications/sending-notifications/ "push receipts are cleared after 24 hours"
const RECEIPT_TTL = 24 * 60 * 60 * 1000;

// source: https://docs.expo.dev/push-notifications/sending-notifications/ "It may either be a single message object (as shown in the example above) or an array of up to 100 message objects"
export async function pushSend(ctx: HandlerContext): Promise<Response> {
  const body = jsonBody(ctx);
  if (body instanceof Response) return body;
  const messages = (Array.isArray(body) ? body : [body]).map(obj);
  // source: https://docs.expo.dev/push-notifications/sending-notifications/ "You are trying to send more than 100 push notifications in one request."
  if (messages.reduce((n, m) => n + (Array.isArray(m.to) ? m.to.length : 1), 0) > 100) return requestError(400, 'PUSH_TOO_MANY_NOTIFICATIONS', 'You are trying to send more than 100 push notifications in one request.');
  // Where the documentation stops: a message without recipients is the twin's VALIDATION_ERROR
  const bad = messages.findIndex((m) => !(typeof m.to === 'string' || (Array.isArray(m.to) && m.to.length && m.to.every((t) => typeof t === 'string'))));
  if (bad >= 0) return requestError(400, 'VALIDATION_ERROR', `"[${bad}].to" must be an Expo push token or an array of them.`);
  // source: https://docs.expo.dev/push-notifications/sending-notifications/ "if your push notification payload is malformed, you may get an HTTP 400 response explaining the issue with the payload"
  const issue = messages.map(messageIssue).find((value) => value !== undefined);
  if (issue) return requestError(400, 'VALIDATION_ERROR', issue);
  const recipients = messages.flatMap((m) => (Array.isArray(m.to) ? m.to as string[] : [String(m.to)]).map((to) => ({ message: m, to })));
  // source: https://docs.expo.dev/push-notifications/sending-notifications/ "You are trying to send push notifications to different Expo experiences"
  const byProject = new Map<string, string[]>();
  for (const r of recipients) { const d = deviceOf(ctx, r.to); if (d) byProject.set(String(d.project), [...(byProject.get(String(d.project)) ?? []), r.to]); }
  if (byProject.size > 1) return requestError(400, 'PUSH_TOO_MANY_EXPERIENCE_IDS', 'All push notification messages in the same request must be for the same project; check the details field to investigate conflicting tokens.', Object.fromEntries(byProject));
  const tickets: Row[] = [];
  for (const r of recipients) {
    const device = isPushToken(r.to) ? deviceOf(ctx, r.to) : undefined;
    // a token no app was given, or one Expo has learned no longer reaches a device
    // source: https://docs.expo.dev/push-notifications/sending-notifications/ "is not a registered push notification recipient"
    if (!device || device.registration === 'unregistered') {
      tickets.push({ status: 'error', message: `"${r.to}" is not a registered push notification recipient`, details: { error: 'DeviceNotRegistered' } });
      continue;
    }
    const id = ctx.mint(NOTIFICATION);
    const { to: _to, ...message } = r.message;
    await ctx.record(NOTIFICATION, { _message: message, to: r.to, _device: device.id, _project: device.project, _sent_at: ctx.occurredAt, _delivery: 'queued' }, id);
    tickets.push({ status: 'ok', id });
  }
  // source: https://docs.expo.dev/push-notifications/sending-notifications/ "or one push ticket object, if you send a single message to a single recipient"
  const single = !Array.isArray(body) && typeof obj(body).to === 'string';
  return Response.json({ data: single ? tickets[0] : tickets });
}

// source: https://docs.expo.dev/push-notifications/sending-notifications/ "If there is no push receipt for a requested receipt ID, the mapping won't contain that ID."
export async function pushGetReceipts(ctx: HandlerContext): Promise<Response> {
  const body = jsonBody(ctx);
  if (body instanceof Response) return body;
  const ids = obj(body).ids;
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string')) return requestError(400, 'VALIDATION_ERROR', '"ids" must be an array of ticket ids.');
  // source: https://docs.expo.dev/push-notifications/sending-notifications/ "You are trying to get more than 1000 push receipts in one request."
  if (ids.length > 1000) return requestError(400, 'PUSH_TOO_MANY_RECEIPTS', 'You are trying to get more than 1000 push receipts in one request.');
  const now = Date.parse(ctx.occurredAt);
  const data: Row = {};
  for (const id of ids as string[]) {
    const n = ctx.row(NOTIFICATION, id);
    if (!n || n._delivery === 'queued' || now - Date.parse(String(n._receipt_at)) >= RECEIPT_TTL) continue;
    data[id] = n._delivery === 'ok' ? { status: 'ok' } : { status: 'error', message: n._receipt_message, details: { error: n._receipt_error } };
  }
  return Response.json({ data });
}
