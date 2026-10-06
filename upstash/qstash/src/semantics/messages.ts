// Messages: a message's read, and cancelling the pending ones a filter names. Publish, enqueue and batch make them
// (./publish.ts, ./enqueue.ts, ./batch.ts); deliveries are the clock's (./clock.ts).
import type { HandlerContext } from '@volter/world-core';
import { callerQStash, fail, MESSAGE, pending, type Row } from './shared.ts';

// a message as QStash answers it: its own fields (ctx.own), without the twin's bookkeeping. Where the documentation
// stops: a header's name is answered as it is kept, lower-cased as HTTP reads names; no page shows its read-back casing.
// source: https://upstash.com/docs/qstash/howto/redact-fields "REDACTED:<SHA256>"
// source: https://upstash.com/docs/qstash/api-reference/messages/publish-a-message "Redact a specific header"
function shown(ctx: HandlerContext, m: Row): Row {
  const out = Object.fromEntries(Object.entries(ctx.own(m)).filter(([k]) => !k.startsWith('_')));
  const fields = String(m._redact ?? '').split(',').map((field) => field.trim().toLowerCase());
  const redact = (value: string): string => `REDACTED:${ctx.crypto.digest('sha256', value)}`;
  if (fields.includes('body')) out.body = redact(String(out.body ?? ''));
  out.header = Object.fromEntries(Object.entries((out.header as Record<string, string[]>) ?? {}).map(([name, values]) => [
    name,
    fields.includes('headers') || fields.includes(`header[${name}]`) || fields.includes(`headers[${name}]`) ? values.map(redact) : values,
  ]));
  return out;
}

/** A message being delivered or retried; one delivered, failed into the DLQ or cancelled is gone (where the documentation
 *  stops: the 404's words are the twin's, in the spec's Error). */
// source: spec:get_v2_messages_messageid "Retrieve details of a specific message"
// source: spec:get_v2_messages_messageid "Messages are removed from the database shortly after they"
export async function get_v2_messages_messageid(ctx: HandlerContext): Promise<Response> {
  const m = ctx.row(MESSAGE, String(ctx.call.params.messageId));
  return m && m._account === callerQStash(ctx)!.id && pending(m) ? Response.json(shown(ctx, m)) : fail(404, 'message not found');
}

/** `DELETE /v2/messages?label=…&queueName=…&url=…&flowControlKey=…&messageIds=…`: every pending message the filters
 *  name cancelled; the count of those that matched. */
// source: spec:delete_v2_messages "Delete all pending messages"
export async function delete_v2_messages(ctx: HandlerContext): Promise<Response> {
  const q = new URL(ctx.call.request.url).searchParams;
  const list = (name: string): string[] => q.getAll(name).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
  const labels = list('label');
  const ids = list('messageIds');
  const queue = q.get('queueName');
  const url = q.get('url');
  const key = q.get('flowControlKey');
  // source: https://upstash.com/docs/qstash/sdks/ts/examples/messages "cancel all messages"
  // Without a filter, all pending messages in this account are cancelled.
  const account = callerQStash(ctx)!;
  const hit = ctx.rowsRaw(MESSAGE).filter((m) => m._account === account.id && pending(m)
    && (!labels.length || ((m.labels as string[] | undefined) ?? []).some((l) => labels.includes(l)))
    && (!ids.length || ids.includes(String(m.messageId))) && (!queue || m.queueName === queue) && (!url || m.url === url) && (!key || m.flowControlKey === key));
  for (const m of hit) await ctx.write(MESSAGE, String(m.messageId), { _state: 'CANCELLED', _resolved: Date.parse(ctx.occurredAt) }, 'message.cancel');
  return Response.json({ cancelled: hit.length }, { status: 202 });
}
