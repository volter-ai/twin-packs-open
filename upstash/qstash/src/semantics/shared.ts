// What QStash's handlers, its clock and its doors share: the account a token names, a message as publish makes it from
// its headers, and a message's delivery: signed, retried on QStash's backoff, into the DLQ with its failure callback
// called when it is out of retries.
import type { HandlerContext } from '@volter/world-core';
import { retryDelay } from '../engine/retry-delay.ts';
// what every lane of upstash shares (architecture, "Pack layout"): the vendor's src/semantics/shared.ts
export * from '../../../src/semantics/shared.ts';

export type Row = Record<string, unknown>;

export const MESSAGE = 'message';
export const QUEUE = 'queue';
export const RUN = 'workflow_run';
export const DELIVERY = '_delivery';
export const DESTINATION = '_destination';
export const QSTASH_USER = 'qstash_user';
export const FLOW = '_flow';
export const flowKey = (m: Row): string => `${String(m._account)}::${String(m.flowControlKey)}`;

export const nowMs = (ctx: Pick<HandlerContext, 'occurredAt'>): number => Date.parse(ctx.occurredAt);
export const iso = (ms: number): string => new Date(ms).toISOString();
/** QStash's refusal: `{ error }` (spec Error). */
export const fail = (status: number, error: string): Response => Response.json({ error }, { status });

const hostOf = (request: Request): string => (request.headers.get('x-volter-twin-original-host') ?? request.headers.get('host') ?? new URL(request.url).host).split(':')[0]!.toLowerCase();

/** The account a request's token names, on the region's host its QStash is at ("Send this token along with every
 *  request made to QStash inside the Authorization header"). */
// source: https://upstash.com/docs/qstash/features/security "inside the"
// source: https://upstash.com/docs/qstash/api/authentication "you can use the qstash_token query parameter instead"
export function callerQStash(ctx: Pick<HandlerContext, 'call' | 'rowsRaw'>): Row | undefined {
  const bearer = /^bearer\s+(\S+)/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1] ?? new URL(ctx.call.request.url).searchParams.get('qstash_token') ?? undefined;
  if (!bearer) return undefined;
  const host = hostOf(ctx.call.request);
  return ctx.rowsRaw(QSTASH_USER).find((q) => q.token === bearer && q.deleted !== true && new URL(String(q._url)).host === host);
}

/** A duration, `<number><unit>` (10s, 1m, 2h, 7d) or several of them in a row (`1d1h30m`, Upstash-Timeout's own example),
 *  in milliseconds: Upstash-Delay's, Upstash-Timeout's and each callback's. Its units are the ones the vendor's examples
 *  use, seconds, minutes, hours and days; any other is not a duration. */
// source: https://upstash.com/docs/qstash/features/delay "The format for the duration is"
// source: https://upstash.com/docs/qstash/features/delay "7d = 7 days"
// source: spec:post_v2_publish_destination "1d1h30m"
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
export function durationMs(raw: string): number | undefined {
  const text = raw.trim();
  if (!/^(?:\d+[smhd])+$/.test(text)) return undefined;
  let total = 0;
  for (const [, n, unit] of text.matchAll(/(\d+)([smhd])/g)) total += Number(n) * UNIT_MS[unit as keyof typeof UNIT_MS];
  return total;
}

/** The delay before the n-th retry: `min(86400, e^(2.5n))` seconds ("Each delay is capped at 1 day": 12s, 2m28s,
 *  30m8s, 6h7m6s, then 24h). */
// source: https://upstash.com/docs/qstash/features/retry "Each delay is capped at 1 day."
export const backoffMs = (n: number): number => Math.round(Math.min(86400, Math.exp(2.5 * n)) * 1000);

/** The headers a message carries to its destination: each `Upstash-Forward-<name>` as `<name>`, its content type, and
 *  Workflow's own `Upstash-Workflow-*` headers as they are ("Sending custom HTTP headers"). */
// source: https://upstash.com/docs/qstash/howto/publishing "Simply add them prefixed with Upstash-Forward-"
export function forwardedOf(headers: Headers): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of headers) {
    const lower = k.toLowerCase();
    // source: https://raw.githubusercontent.com/upstash/workflow-js/v1.3.0/src/qstash/headers.ts "Upstash-Forward-${WORKFLOW_PROTOCOL_VERSION_HEADER}"
    // The raw protocol version configures QStash; the explicit forward header carries it to the route.
    const name = lower.startsWith('upstash-forward-') ? lower.slice('upstash-forward-'.length) : lower === 'content-type' || (lower.startsWith('upstash-workflow-') && lower !== 'upstash-workflow-sdk-version') ? lower : undefined;
    if (name) (out[name] ??= []).push(v);
  }
  return out;
}

/** A callback's own headers: `Upstash-Callback-Forward-<name>` and `Upstash-Failure-Callback-Forward-<name>` as `<name>`. */
const callbackForwarded = (headers: Headers, prefix: string): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const [k, v] of headers) if (k.toLowerCase().startsWith(prefix)) (out[k.toLowerCase().slice(prefix.length)] ??= []).push(v);
  return out;
};

/** A publish's answer: a duplicate is accepted with the existing message's id and 202 ("We'll send HTTP 202 Accepted
 *  code in case of a duplicate message"). */
// source: https://upstash.com/docs/qstash/features/deduplication "code in case of a duplicate message"
export const published = (out: { answer: Row; deduplicated: boolean }): Response => Response.json(out.answer, { status: out.deduplicated ? 202 : 200 });

/** A delivery's options as one prefix of a publish's headers sets them: `Upstash-` for the message itself, and, for
 *  its callbacks, `Upstash-Callback-` and `Upstash-Failure-Callback-` ("Instead of the Upstash prefix for headers, the
 *  Upstash-Callback / Upstash-Failure-Callback prefix can be used to configure callbacks"). Each unset option is
 *  undefined (the message's defaults, or for a callback the message's own: "Default is same as original message
 *  retries"). */
// source: https://upstash.com/docs/qstash/features/callbacks "Publishes/enqueues for callbacks can also be configured with the same HTTP headers that are used to configure direct publishes/enqueues."
type Options = { method?: string; timeoutMs?: number; retries?: number; retryExpression?: string; delayMs?: number; flowKey?: string; flow: Record<string, string> };
function optionsOf(headers: Headers, prefix: 'Upstash-' | 'Upstash-Callback-' | 'Upstash-Failure-Callback-'): Options | Response {
  const h = (name: string): string | undefined => headers.get(`${prefix}${name}`) ?? undefined;
  // source: https://upstash.com/docs/qstash/api-reference/messages/publish-a-message "The HTTP method to use when sending the request to your API."
  const method = h('Method');
  // source: https://upstash.com/docs/qstash/api-reference/messages/publish-a-message "Specifies the maximum duration the request is allowed to take before timing out."
  // source: https://upstash.com/docs/qstash/api-reference/messages/publish-a-message "Format is same as Upstash-Timeout header."
  const timeout = h('Timeout');
  const timeoutMs = timeout === undefined ? undefined : durationMs(timeout) ?? Number.NaN;
  // Where the documentation stops: a malformed option has no stated error text; each is refused in the spec's {error}.
  if (timeoutMs !== undefined && !(timeoutMs > 0)) return fail(400, `invalid ${prefix}Timeout: ${timeout}`);
  const retriesRaw = h('Retries');
  const retries = retriesRaw === undefined ? undefined : Number(retriesRaw);
  if (retries !== undefined && (!Number.isInteger(retries) || retries < 0)) return fail(400, `invalid ${prefix}Retries: ${retriesRaw}`);
  // source: https://upstash.com/docs/qstash/api-reference/messages/publish-a-message "Retry delay for the callback request. Format is same as Upstash-Retry-Delay header."
  const retryExpression = h('Retry-Delay');
  // source: https://upstash.com/docs/qstash/features/callbacks "Upstash-Callback-Delay"
  const delay = h('Delay');
  const delayMs = delay === undefined ? undefined : durationMs(delay);
  if (delay !== undefined && delayMs === undefined) return fail(400, `invalid ${prefix}Delay: ${delay}`);
  // source: https://upstash.com/docs/qstash/api-reference/messages/publish-a-message "Format: parallelism=<value>, rate=<value>, period=<value>"
  const flow = Object.fromEntries((h('Flow-Control-Value') ?? '').split(',').map((p) => p.trim().split('=')).filter((p) => p.length === 2));
  if (Object.entries(flow).some(([k, v]) => k === 'period' ? !(durationMs(String(v)) ?? 0) : !['parallelism', 'rate'].includes(k) || !Number.isInteger(Number(v)) || Number(v) <= 0)) return fail(400, `invalid ${prefix}Flow-Control`);
  // The key asks for its value beside it ("Make sure you pass Upstash-Flow-Control-Value header as well to define the
  // limits for the key"), and the value for its key:
  // source: spec:post_v2_publish_destination "header as well to define the limits for the key."
  // source: https://upstash.com/docs/qstash/api-reference/messages/publish-a-message "Make sure you pass Upstash-Flow-Control-Key header as well to define the key."
  // Where the documentation stops: neither page says what QStash answers to one without the other. A key alone is taken
  // as naming its limits as they stand (a pinned key's, set on the console: "incoming messages cannot override it"),
  // limiting nothing when it has none; a value alone limits nothing. Neither is refused.
  // source: https://upstash.com/docs/qstash/features/flowcontrol "incoming messages cannot override it"
  // For a callback (Upstash-Callback-Flow-Control-*, Upstash-Failure-Callback-Flow-Control-*) the flow control is
  // extrapolated from the callbacks page's general sentence, that a callback is configured "with the same HTTP headers"
  // as a publish (cited above optionsOf); no page names a callback's flow-control headers or shows one.
  return { method, timeoutMs, retries, retryExpression, delayMs, flowKey: h('Flow-Control-Key'), flow };
}

/** The retry expression's every value its retries reach, or the refusal. */
function invalidExpression(expression: string | undefined, retries: number, header: string): Response | undefined {
  // Where the documentation stops: a malformed expression's error text; it is refused in the spec's {error}.
  if (expression !== undefined && Array.from({ length: retries + 1 }, (_, n) => retryDelay(expression, n)).some((delay) => delay === undefined)) return fail(400, `invalid ${header}`);
  return undefined;
}

/** A key's limits, as a publish's flow-control value sets them on its key; the key alone keeps them. */
async function recordFlow(ctx: HandlerContext, account: Row, o: Options): Promise<void> {
  if (!o.flowKey) return;
  // An unpinned key's supplied limits update its configuration. The management API is outside the demand.
  // source: https://upstash.com/docs/qstash/features/flowcontrol "By default, the period is set to 1 second"
  await ctx.record(FLOW, { ...(o.flow.parallelism ? { parallelism: Number(o.flow.parallelism) } : {}),
    ...(o.flow.rate ? { rate: Number(o.flow.rate), period: durationMs(o.flow.period ?? '1s') } : {}) }, flowKey({ _account: account.id, flowControlKey: o.flowKey }));
}

/** One message as publish, batch and enqueue make it: its destination, body and headers read; deduplicated within ten
 *  minutes by its id or its content ("The deduplication window is 10 minutes"); its queue's, when enqueued. Answers the
 *  PublishResponse, or the refusal. */
// source: https://upstash.com/docs/qstash/features/deduplication "The deduplication window is 10 minutes."
export async function publishOne(ctx: HandlerContext, account: Row, input: { destination: string; body: string; headers: Headers; queueName?: string }): Promise<{ answer: Row; deduplicated: boolean } | Response> {
  const h = (name: string): string | undefined => input.headers.get(name) ?? undefined;
  let url: URL;
  // source: spec:post_v2_publish_destination "If the destination is a URL Group, a new message will be created for each endpoint in the group."
  // A destination that is not a URL names a URL Group; the World's account holds none (URL Groups are the gap), so it
  // is the group the account does not hold. Where the documentation stops: publish documents 200, 400 and 401 and no
  // answer for a group the account lacks; the 404 and its words are borrowed from Get a URL Group
  // (get_v2_topics_urlgroupname), the operation that documents a missing group.
  // source: spec:get_v2_topics_urlgroupname "URL Group not found"
  try { url = new URL(input.destination); } catch { return fail(404, 'URL Group not found'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fail(400, `invalid destination url: ${input.destination}`);
  const now = nowMs(ctx);
  const forwarded = forwardedOf(input.headers);
  const own = optionsOf(input.headers, 'Upstash-');
  if (own instanceof Response) return own;
  const callbackOptions = optionsOf(input.headers, 'Upstash-Callback-');
  if (callbackOptions instanceof Response) return callbackOptions;
  const failureOptions = optionsOf(input.headers, 'Upstash-Failure-Callback-');
  if (failureOptions instanceof Response) return failureOptions;
  // the deduplication id: given, or the content's (destination, body, content type and forwarded headers)
  const content = h('upstash-content-based-deduplication') === 'true' ? ctx.crypto.digest('sha256', JSON.stringify([input.destination, input.body, forwarded])) : undefined;
  const dedup = h('upstash-deduplication-id') ?? content;
  if (dedup) {
    const held = ctx.rowsRaw(MESSAGE).find((m) => m._account === account.id && m._dedup === dedup && now - Number(m.createdAt) < 600_000);
    if (held) return { answer: { messageId: held.messageId, deduplicated: true }, deduplicated: true };
  }
  const notBefore = h('upstash-not-before') ? Number(h('upstash-not-before')) * 1000 : now + (own.delayMs ?? 0);
  if (!Number.isFinite(notBefore)) return fail(400, `invalid Upstash-Not-Before: ${h('upstash-not-before')}`);
  // source: https://upstash.com/docs/qstash/api-reference/messages/publish-a-message "If it is not provided, the default of 3 retries is used."
  const retries = own.retries ?? 3;
  const refused = invalidExpression(own.retryExpression, retries, 'Upstash-Retry-Delay')
    ?? invalidExpression(callbackOptions.retryExpression ?? own.retryExpression, callbackOptions.retries ?? retries, 'Upstash-Callback-Retry-Delay')
    ?? invalidExpression(failureOptions.retryExpression ?? own.retryExpression, failureOptions.retries ?? retries, 'Upstash-Failure-Callback-Retry-Delay');
  if (refused) return refused;
  await recordFlow(ctx, account, own);
  if (input.queueName && !ctx.row(QUEUE, queueKey(account, input.queueName))) {
    // "the queue is created by its first enqueue", with parallelism 1 ("By default, queues have parallelism 1")
    // source: https://upstash.com/docs/qstash/features/queues "By default, queues have parallelism 1."
    await ctx.write(QUEUE, queueKey(account, input.queueName), { name: input.queueName, parallelism: 1, paused: false, createdAt: now, updatedAt: now, _account: account.id }, 'queue.create');
  }
  const messageId = `msg_${ctx.mint('Message')}`;
  // source: https://upstash.com/docs/qstash/api-reference/messages/publish-a-message "You can assign multiple labels by providing a comma-separated list."
  const labels = h('upstash-label')?.split(',').map((label) => label.trim()).filter(Boolean);
  const runId = h('upstash-workflow-runid');
  if (runId && h('upstash-workflow-init') === 'true' && !ctx.row(RUN, runId)) {
    await ctx.write(RUN, runId, {
      workflowRunId: runId, workflowUrl: h('upstash-workflow-url') ?? input.destination, workflowState: 'RUN_STARTED', workflowRunCreatedAt: now,
      ...(labels?.length ? { label: labels[0], labels } : {}), ...(own.flowKey ? { flowControlKey: own.flowKey } : {}),
    }, 'workflow_run.start');
  }
  // what a callback is published with: its own options over the message's retry settings ("Callbacks will use the
  // retry setting from the original request"; "Default is same as original message retries")
  // source: https://upstash.com/docs/qstash/api-reference/messages/publish-a-message "Callbacks will use the retry setting from the original request."
  // source: https://upstash.com/docs/qstash/api-reference/messages/publish-a-message "Default is same as original message retries."
  const callbackOf = (o: Options, prefix: string): Row => Object.fromEntries(Object.entries({ ...o, retries: o.retries ?? retries, retryExpression: o.retryExpression ?? own.retryExpression, headers: callbackForwarded(input.headers, `${prefix}forward-`) }).filter(([, v]) => v !== undefined));
  await ctx.write(MESSAGE, messageId, {
    messageId, url: input.destination, method: own.method ?? 'POST', header: forwarded, body: input.body, maxRetries: retries, notBefore, createdAt: now,
    ...(h('upstash-callback') ? { callback: h('upstash-callback') } : {}), ...(h('upstash-failure-callback') ? { failureCallback: h('upstash-failure-callback') } : {}),
    ...(input.queueName ? { queueName: input.queueName } : {}), ...(labels?.length ? { label: labels[0], labels } : {}),
    ...(own.flowKey ? { flowControlKey: own.flowKey, ...(own.flow.parallelism ? { parallelism: Number(own.flow.parallelism) } : {}) } : {}),
    ...(own.retryExpression !== undefined ? { _retryExpression: own.retryExpression } : {}), ...(own.timeoutMs !== undefined ? { _timeout: own.timeoutMs } : {}),
    // source: https://upstash.com/docs/qstash/howto/redact-fields "The original values are still used when delivering messages to your endpoint."
    ...(h('upstash-redact-fields') ? { _redact: h('upstash-redact-fields') } : {}),
    _due: notBefore, _state: 'CREATED', _account: account.id, ...(dedup ? { _dedup: dedup } : {}), ...(runId ? { _run: runId } : {}),
    _callback: callbackOf(callbackOptions, 'upstash-callback-'), _failure: callbackOf(failureOptions, 'upstash-failure-callback-'),
  }, 'message.publish');
  return { answer: { messageId }, deduplicated: false };
}

/** A queue's subject: an account's queue by its name. */
export const queueKey = (account: Row, name: string): string => `${String(account.id)}::${name}`;

/** A message waiting for delivery: not yet delivered, failed or cancelled. */
export const pending = (m: Row): boolean => m._state === 'CREATED' || m._state === 'RETRY';

/** A message QStash itself publishes (a callback, a failure callback), delivered as any other: "Callbacks publish a new
 *  message with the response to the callback URL", with the options its publish set for it. */
// source: https://upstash.com/docs/qstash/features/callbacks "Callbacks publish a new message with the response to the callback URL."
async function publishOwn(ctx: HandlerContext, source: Row, url: string, body: Row, options: Row): Promise<void> {
  const messageId = `msg_${ctx.mint('Message')}`;
  const now = nowMs(ctx);
  const o = { flow: {}, ...options } as Options & { headers?: Record<string, string[]> };
  const account = { id: source._account };
  await recordFlow(ctx, account, o);
  const notBefore = now + (o.delayMs ?? 0);
  await ctx.write(MESSAGE, messageId, {
    messageId, url, method: o.method ?? 'POST', header: { 'content-type': ['application/json'], ...(o.headers ?? {}) }, body: JSON.stringify(body), maxRetries: o.retries ?? source.maxRetries, notBefore, createdAt: now,
    ...(o.flowKey ? { flowControlKey: o.flowKey, ...(o.flow.parallelism ? { parallelism: Number(o.flow.parallelism) } : {}) } : {}),
    ...(typeof o.retryExpression === 'string' ? { _retryExpression: o.retryExpression } : {}), ...(o.timeoutMs !== undefined ? { _timeout: o.timeoutMs } : {}),
    _due: notBefore, _state: 'CREATED', _account: source._account,
  }, 'message.publish');
}

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

/** What a workflow run's later call carries: the run's steps so far, as a JSON array whose first entry is the initial
 *  payload and each next a step the route sent back, each body base64 (the Workflow SDK reads it so: `processRawSteps`,
 *  `const [encodedInitialPayload, ...encodedSteps] = rawSteps`, @upstash/workflow 1.3.0). The first call (its
 *  `Upstash-Workflow-Init: true`) carries the initial payload as it is: undefined here. */
// source: https://upstash.com/docs/workflow/basics/how "resumes exactly where it left off by restoring the previous step results"
function workflowBody(ctx: HandlerContext, m: Row): string | undefined {
  if (typeof m._run !== 'string') return undefined;
  const init = (h: Row): boolean => ((h.header as Record<string, string[]> | undefined)?.['upstash-workflow-init'] ?? [])[0] === 'true';
  if (init(m)) return undefined;
  const run = ctx.rowsRaw(MESSAGE).filter((x) => x._run === m._run && x._account === m._account && Number(x.createdAt) <= Number(m.createdAt) && x.url === m.url);
  const first = run.find(init);
  const steps = run.filter((x) => !init(x));
  return JSON.stringify([
    { messageId: first?.messageId ?? '', body: b64(String(first?.body ?? '')), callType: 'step' },
    ...steps.map((x) => ({ messageId: x.messageId, body: b64(String(x.body ?? '')), callType: 'step' })),
  ]);
}

/** How long QStash waits for a destination's answer: the publish's Upstash-Timeout, which can only shorten the plan's
 *  Max HTTP Response Duration (the account's `timeout`, in seconds), or that duration when it sets none. Where the
 *  documentation stops: a longer Upstash-Timeout is not refused (1d1h30m is the header's own example, longer than every
 *  plan's but Enterprise's); it is held to the plan's. */
// source: spec:post_v2_publish_destination "This parameter can be used to shorten the default allowed timeout value on your plan."
// source: https://upstash.com/docs/qstash/features/retry "QStash will abort a delivery attempt if the HTTP call to your endpoint does not return within the plan-specific Max HTTP Response Duration."
const PLAN_TIMEOUT_S = 7200;
const allowedMs = (account: Row, m: Row): number => {
  // an account row that holds no `timeout` waits Pay as you go's two hours: the twin's account is made on Pay as you go
  // (where the documentation stops: a new real Upstash account starts on Free, whose response duration is 15 minutes)
  // source: https://upstash.com/pricing/qstash "Max HTTP response duration: 2 hours"
  const plan = (typeof account.timeout === 'number' ? account.timeout : PLAN_TIMEOUT_S) * 1000;
  return typeof m._timeout === 'number' ? Math.min(m._timeout, plan) : plan;
};

/** One attempt of a message as it is sent at the moment it falls due: signed with the account's current signing key (a
 *  JWT, HS256, whose `body` is the base64url SHA-256 of the body, living five minutes), with `Upstash-Message-Id` and
 *  `Upstash-Retried`; asked of the application, or of the World's stand-in for it when no application answers there.
 *  Writes nothing itself (an application asked may publish during its request), so the clock asks the attempts due at
 *  one instant one at a time, in its stable order. Answers the attempt: the request, the
 *  answer (or what was missed) and when, on the World's clock, the answer arrives (a stand-in's `takes`, no later than
 *  the attempt may wait). */
// source: https://upstash.com/docs/qstash/features/security "Our JWTs have a lifetime of 5 minutes by default."
export async function send(ctx: HandlerContext, m: Row): Promise<Row> {
  const account = ctx.rowsRaw(QSTASH_USER).find((q) => q.id === m._account) ?? {};
  const url = String(m.url);
  const body = workflowBody(ctx, m) ?? String(m.body ?? '');
  const retried = ctx.history(MESSAGE, String(m.messageId)).filter((w) => w.operation === 'message.attempt').length;
  const now = Math.floor(nowMs(ctx) / 1000);
  const signature = ctx.crypto.jwtSign(
    { iss: 'Upstash', sub: url, jti: `jwt_${ctx.crypto.digest('sha256', `${String(m.messageId)}:${retried}`).slice(0, 24)}`, body: ctx.crypto.digest('sha256', body, 'base64url') },
    { alg: 'HS256', secret: String(account._current_signing_key) },
    { now, expiresInSeconds: 300 },
  );
  const headers: Record<string, string> = { 'user-agent': 'Upstash-QStash', 'upstash-message-id': String(m.messageId), 'upstash-retried': String(retried), 'upstash-signature': signature };
  for (const [k, vs] of Object.entries((m.header as Record<string, string[]> | undefined) ?? {})) headers[k] = vs.join(', ');
  const within = allowedMs(account, m);
  const method = String(m.method ?? 'POST');
  const asked = await ctx.ask(url, { method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body }) }, within);
  let answer = { status: asked.status, body: asked.body, headers: asked.headers, missed: asked.missed as string | undefined, takes: 0 };
  if (asked.missed === 'unreachable') {
    // the stand-in for this URL whose conditions the request meets: the most particular (the longest URL, then the one
    // with conditions); one that takes longer than the attempt may wait has not answered when the attempt gives up
    const meets = (d: Row): boolean => url.startsWith(String(d.url)) && Object.entries((d.when as Record<string, string> | undefined) ?? {}).every(([k, v]) => headers[k] === v);
    const weight = (d: Row): number => String(d.url).length * 100 + Object.keys((d.when as Row | undefined) ?? {}).length;
    const standIn = ctx.rowsRaw(DESTINATION).filter(meets).sort((a, b) => weight(b) - weight(a))[0];
    const takes = Number(standIn?.takes ?? 0);
    answer = !standIn ? { ...answer, takes: 0 }
      : takes > within ? { status: 0, body: '', headers: {}, missed: 'timeout', takes: within }
      : { status: Number(standIn.status), body: String(standIn.body ?? ''), headers: (standIn.headers as Record<string, string> | undefined) ?? {}, missed: undefined, takes };
  }
  return { at: ctx.occurredAt, answerAt: nowMs(ctx) + answer.takes, url, method, headers, body, retried, status: answer.status, answer: answer.body, answerHeaders: answer.headers, ...(answer.missed && !answer.status ? { missed: answer.missed } : {}) };
}

/** An attempt sent: what QStash sent is in the World's record of deliveries at once, and the message holds the attempt,
 *  in flight, until its answer arrives. */
export async function sent(ctx: HandlerContext, m: Row, attempt: Row): Promise<void> {
  const delivery = ctx.mint('_delivery');
  await ctx.record(DELIVERY, { message: m.messageId, ...(typeof m._run === 'string' ? { run: m._run } : {}), url: attempt.url, method: attempt.method, headers: attempt.headers, body: attempt.body, retried: attempt.retried, at: attempt.at }, delivery);
  await ctx.write(MESSAGE, String(m.messageId), { _inflight: { ...attempt, delivery } }, 'message.send');
}

/** An attempt's answer, at the moment it arrives: a 2xx delivers the message; anything else retries it on the backoff
 *  until its retries are spent, then it fails into the DLQ and its failure callback is called (a 489 with
 *  `Upstash-NonRetryable-Error: true` fails it at once). Its key's parallelism slot is held until now. */
export async function settle(ctx: HandlerContext, id: string): Promise<void> {
  const m = ctx.row(MESSAGE, id)!;
  const attempt = m._inflight as Row;
  const status = Number(attempt.status);
  const answerBody = String(attempt.answer ?? '');
  const answerHeaders = (attempt.answerHeaders as Record<string, string> | undefined) ?? {};
  await ctx.record(DELIVERY, { status, answer: answerBody, ...(attempt.missed ? { missed: attempt.missed } : {}) }, String(attempt.delivery));
  await ctx.write(MESSAGE, id, { _lastStatus: status, _inflight: null }, 'message.attempt');
  if (m.flowControlKey !== undefined) await ctx.change(FLOW, flowKey(m), (flow) => ({ active: ((flow.active as string[] | undefined) ?? []).filter((x) => x !== m.messageId), lastAt: Math.max(Number(flow.lastAt ?? 0), nowMs(ctx)) }), 'flow.release');
  // a message cancelled while its attempt was in flight stays cancelled: the answer moves nothing
  if (!pending(m)) { await ctx.write(MESSAGE, id, { _active: false }, 'message.answered'); return; }
  const url = String(m.url);
  const body = String(attempt.body ?? '');
  const retried = Number(attempt.retried);
  const source = { sourceMessageId: m.messageId, url, method: m.method ?? 'POST', sourceHeader: m.header, sourceBody: b64(body), notBefore: String(m.notBefore), createdAt: String(m.createdAt), retried, maxRetries: m.maxRetries, status, header: Object.fromEntries(Object.entries(answerHeaders).map(([k, v]) => [k, [v]])), body: b64(answerBody) };
  if (status >= 200 && status < 300) {
    await ctx.write(MESSAGE, id, { _state: 'DELIVERED', _resolved: nowMs(ctx), _active: false }, 'message.delivered');
    if (typeof m.callback === 'string') await publishOwn(ctx, m, m.callback, source, (m._callback as Row | undefined) ?? {});
    return;
  }
  // source: https://upstash.com/docs/qstash/features/retry "respond with a 489 status code and include the header Upstash-NonRetryable-Error: true"
  const nonRetryable = status === 489 && answerHeaders['upstash-nonretryable-error'] === 'true';
  if (!nonRetryable && retried < Number(m.maxRetries)) {
    // source: https://upstash.com/docs/qstash/api-reference/messages/publish-a-message "This expression is computed after each failed attempt."
    // The publish validated every configured retry value; re-evaluation uses this failed attempt's count.
    const delay = typeof m._retryExpression === 'string' ? retryDelay(m._retryExpression, retried)! : backoffMs(retried + 1);
    await ctx.write(MESSAGE, id, { _state: 'RETRY', _due: nowMs(ctx) + delay, _active: false }, 'message.retry');
    return;
  }
  // out of retries: into the DLQ ("dlqId": "1725323658779-0", the failure callback's own example)
  // where the documentation stops: its shape is the failure callback example's (`1725323658779-0`): the instant, and the
  // DLQ entry's minted number
  const seq = ctx.mint('_dlq');
  const dlqId = `${nowMs(ctx)}-${seq}`;
  await ctx.record('_dlq', { message: m.messageId, dlqId }, seq);
  await ctx.write(MESSAGE, id, { _state: 'FAILED', _resolved: nowMs(ctx), _dlqId: dlqId, _active: false }, 'message.failed');
  if (typeof m._run === 'string') {
    const run = ctx.row(RUN, m._run);
    if (run && run.workflowState === 'RUN_STARTED' && !ctx.legal('WorkflowRun', 'workflowState', 'clock', 'RUN_STARTED', 'RUN_FAILED', String(m._run), 'vendor')) {
      await ctx.write(RUN, String(m._run), { workflowState: 'RUN_FAILED', workflowRunCompletedAt: nowMs(ctx), dlqId }, 'workflow_run.failed');
    }
  }
  if (typeof m.failureCallback === 'string') await publishOwn(ctx, m, m.failureCallback, { ...source, dlqId }, (m._failure as Row | undefined) ?? {});
}
