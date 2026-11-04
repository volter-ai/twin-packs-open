// Sentry's ingestion endpoint (spec: sendEnvelope; develop-docs/sdk/foundations/envelopes/index.mdx): an envelope, its
// header line and its items, each kept as what it is. The envelope is authenticated by the DSN's public key (the
// X-Sentry-Auth header, the `sentry_key` query parameter, or the envelope header's `dsn`), and answered with its event id.
import { s3, type HandlerContext } from '@volter/world-core';
import { apiManifest, ATTACHMENT, CHECK_IN, CLIENT_REPORT, keepEvent, LOG, METRIC, MONITOR, next, OTHER_ITEM, PROFILE, projectByKey, REPLAY, type Row, SESSION } from './shared.ts';

const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
const refuse = (status: number, detail: string): Response =>
  Response.json({ detail }, { status, headers: { 'x-sentry-error': detail } });

// source: https://raw.githubusercontent.com/getsentry/sentry-docs/3ec4e139711af82b38a3c2c17261f5f5cdb66dfc/develop-docs/sdk/foundations/envelopes/index.mdx "*200 MiB* for an envelope after decompression including all envelope items."
const MAX_ENVELOPE = 200 * 1024 * 1024;

/** The body's bytes: the kernel has decoded a gzip, deflate, br or zstd body (the manifest's `encodings`) and dropped the
 *  header, so a Content-Encoding still on the request is one Sentry does not read. */
function decoded(bytes: Uint8Array, encoding: string | null): Uint8Array | string {
  const coding = (encoding ?? '').toLowerCase();
  return coding === '' || coding === 'identity' ? bytes : `unsupported content encoding: ${encoding}`;
}

type Item = { header: Row; payload: Uint8Array };

/** An envelope read: its header and items. An item's header may give its `length`, else it runs to the newline
 *  (develop-docs/sdk/foundations/envelopes/index.mdx, "Envelopes" and "Items"). */
function parse(bytes: Uint8Array): { header: Row; items: Item[] } | string {
  let at = 0;
  const line = (): Uint8Array | undefined => {
    if (at >= bytes.length) return undefined;
    let end = bytes.indexOf(10, at);
    if (end < 0) end = bytes.length;
    const out = bytes.subarray(at, end);
    at = end + 1;
    return out;
  };
  const json = (b: Uint8Array | undefined): Row | undefined => {
    if (!b) return undefined;
    try { const v = JSON.parse(new TextDecoder().decode(b)); return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined; } catch { return undefined; }
  };
  const header = json(line());
  if (!header) return 'invalid envelope header';
  const items: Item[] = [];
  while (at < bytes.length) {
    const raw = line();
    if (!raw || raw.length === 0 || (raw.length === 1 && raw[0] === 13)) continue;
    const h = json(raw);
    if (!h || typeof h.type !== 'string') return 'invalid item header';
    let payload: Uint8Array;
    if (typeof h.length === 'number') {
      if (!Number.isInteger(h.length) || h.length < 0) return 'invalid item length';
      if (at + h.length > bytes.length) return 'item payload is shorter than its length';
      payload = bytes.subarray(at, at + h.length);
      at += h.length;
      if (at < bytes.length && bytes[at] !== 10) return 'length-prefixed payload must end with newline or EOF';
      if (bytes[at] === 10) at += 1;
    } else payload = line() ?? new Uint8Array(0);
    items.push({ header: h, payload });
  }
  return { header, items };
}

/** The public key a request authenticates with: X-Sentry-Auth's `sentry_key`, the query's, or the envelope's DSN. */
function publicKeyOf(request: Request, header: Row): string | undefined {
  const auth = request.headers.get('x-sentry-auth') ?? '';
  const fromHeader = /sentry_key=([^,\s]+)/.exec(auth)?.[1];
  const fromQuery = new URL(request.url).searchParams.get('sentry_key') ?? undefined;
  let fromDsn: string | undefined;
  if (typeof header.dsn === 'string') { try { fromDsn = new URL(header.dsn).username || undefined; } catch { /* not a URL */ } }
  const given = [fromHeader, fromQuery, fromDsn].filter((k): k is string => !!k);
  // "If multiple forms of authentication are given, the endpoint validates that the information matches and otherwise
  // rejects the request" (envelopes/index.mdx, Authentication)
  return given.length && given.every((k) => k === given[0]) ? given[0] : given.length ? '' : undefined;
}

const text = (b: Uint8Array): string => new TextDecoder().decode(b);
const asJson = (b: Uint8Array): Row => { try { return obj(JSON.parse(text(b))); } catch { return {}; } };

// source: spec:sendEnvelope "The main ingestion endpoint for Envelopes."
export async function sendEnvelope(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const body = decoded(s3.bytesOf(request), request.headers.get('content-encoding'));
  ctx = await ctx.over(apiManifest);
  if (typeof body === 'string') return refuse(400, body);
  if (body.length > MAX_ENVELOPE) return refuse(413, 'envelope exceeded size limits');
  const envelope = parse(body);
  if (typeof envelope === 'string') return refuse(400, `invalid envelope: ${envelope}`);
  const key = publicKeyOf(request, envelope.header);
  // "If both are missing, the Envelope is rejected with status code `403 Forbidden`." (envelopes/index.mdx)
  if (key === undefined) return refuse(403, 'missing authorization information');
  if (key === '') return refuse(403, 'the authentication given does not match');
  // Where the documentation stops: Relay's answer for a key no project has is not a page's; the twin refuses it as
  // missing authentication is refused, and a key of another project than the path's likewise
  const project = projectByKey(ctx, key);
  if (!project || String(project.id) !== String(ctx.call.params.project_id)) return refuse(403, 'invalid api key');
  const org = obj(ctx.row('organization', String(project._organization)));
  const envelopeId = typeof envelope.header.event_id === 'string' ? envelope.header.event_id.replace(/-/g, '') : undefined;
  const sentAt = typeof envelope.header.sent_at === 'string' ? envelope.header.sent_at : ctx.occurredAt;
  const base = { project: project.id, organization: org.id ?? project._organization, received: ctx.occurredAt, sent_at: sentAt };
  // source: https://raw.githubusercontent.com/getsentry/sentry-docs/3ec4e139711af82b38a3c2c17261f5f5cdb66dfc/develop-docs/sdk/foundations/envelopes/index.mdx "*1 MiB* for event (errors and transactions), span, log, and metric (statsd, buckets, meta) envelope items."
  let sessions = 0;
  for (const item of envelope.items) {
    const kind = String(item.header.type);
    const limit = ({ event: 1048576, transaction: 1048576, span: 1048576, log: 1048576, trace_metric: 1048576, statsd: 1048576, metric_buckets: 1048576, metric_meta: 1048576, check_in: 102400, client_report: 4096, profile: 52428800, replay_event: 104857600, replay_recording: 10485760, replay_video: 10485760 } as Record<string, number>)[kind];
    if (limit && item.payload.length > limit) return refuse(413, 'item exceeded size limits');
    const payload = asJson(item.payload);
    if (kind === 'session') sessions++;
    if (sessions > 100 || (kind === 'sessions' && Array.isArray(payload.aggregates) && payload.aggregates.length > 100)) return refuse(413, 'too many sessions');
    if (kind === 'trace_metric' && Array.isArray(payload.items) && payload.items.some((metric) => new TextEncoder().encode(JSON.stringify(metric)).length > 2048)) return refuse(413, 'metric exceeded size limits');
  }
  let n = 0;
  const envelopeN = await next(ctx, 'envelope');
  const receipt = `envelope/${String(project.id)}/${envelopeN}`;
  await ctx.blobs.put(receipt, body);
  await ctx.record('_envelope', { ...base, header: envelope.header, blob: receipt, size: body.length }, `${String(project.id)}:${envelopeN}`);
  const id = (kind: string): string => `${String(project.id)}:${kind}:${envelopeN}:${n++}`;
  for (const item of envelope.items) {
    const type = String(item.header.type);
    const p = asJson(item.payload);
    switch (type) {
      case 'event': await keepEvent(ctx, project, { ...p, event_id: envelopeId ?? p.event_id }, p.exception ? 'error' : 'default'); break;
      case 'transaction': await keepEvent(ctx, project, { ...p, event_id: envelopeId ?? p.event_id }, 'transaction'); break;
      case 'feedback': await keepEvent(ctx, project, { ...p, event_id: envelopeId ?? p.event_id }, 'feedback'); break;
      case 'attachment': {
        const blob = `attachment/${String(project.id)}/${envelopeId ?? 'none'}/${String(item.header.filename ?? n)}`;
        await ctx.blobs.put(blob, item.payload);
        await ctx.record(ATTACHMENT, { ...base, event_id: envelopeId ?? null, name: item.header.filename ?? null, type: item.header.attachment_type ?? 'event.attachment', mimetype: item.header.content_type ?? 'application/octet-stream', size: item.payload.length, blob }, id(ATTACHMENT));
        break;
      }
      case 'session': await ctx.record(SESSION, { ...base, sid: p.sid ?? null, did: p.did ?? null, status: p.status ?? 'ok', errors: p.errors ?? 0, init: p.init ?? false, started: p.started ?? null, duration: p.duration ?? null, attrs: obj(p.attrs) }, `${String(project.id)}:session:${String(p.sid ?? id(SESSION))}`); break;
      case 'sessions': await ctx.record(SESSION, { ...base, aggregates: p.aggregates ?? [], attrs: obj(p.attrs) }, id(SESSION)); break;
      case 'client_report': await ctx.record(CLIENT_REPORT, { ...base, timestamp: p.timestamp ?? null, discarded_events: p.discarded_events ?? [] }, id(CLIENT_REPORT)); break;
      case 'replay_event': await ctx.record(REPLAY, { ...base, replay_id: p.replay_id ?? envelopeId ?? null, segment_id: p.segment_id ?? 0, replay_type: p.replay_type ?? null, urls: p.urls ?? [], error_ids: p.error_ids ?? [], trace_ids: p.trace_ids ?? [], timestamp: p.timestamp ?? null }, id(REPLAY)); break;
      case 'replay_recording': case 'replay_video': {
        const blob = `replay/${String(project.id)}/${envelopeId ?? 'none'}/${n}`;
        await ctx.blobs.put(blob, item.payload);
        await ctx.record(REPLAY, { ...base, replay_id: envelopeId ?? null, recording: blob, kind: type, size: item.payload.length }, id(REPLAY));
        break;
      }
      case 'profile': case 'profile_chunk': {
        const blob = `profile/${String(project.id)}/${envelopeId ?? 'none'}/${n}`;
        await ctx.blobs.put(blob, item.payload);
        await ctx.record(PROFILE, { ...base, kind: type, profile_id: p.profile_id ?? p.event_id ?? null, chunk_id: p.chunk_id ?? null, platform: p.platform ?? null, release: p.release ?? null, size: item.payload.length, blob }, id(PROFILE));
        await ctx.write('project', String(project.id), { hasProfiles: true }, 'project.update');
        break;
      }
      case 'check_in': {
        const slug = String(p.monitor_slug ?? '');
        const config = obj(p.monitor_config);
        const monitor = ctx.rowsRaw(MONITOR).find((m) => m._project === project.id && m.slug === slug);
        const monitorId = monitor ? String(monitor.id) : ctx.mint(MONITOR);
        const monitorConfig = Object.keys(config).length ? {
          schedule_type: obj(config.schedule).type, schedule: obj(config.schedule).value,
          checkin_margin: config.checkin_margin ?? null, max_runtime: config.max_runtime ?? null, timezone: config.timezone ?? null,
          failure_issue_threshold: config.failure_issue_threshold ?? null, recovery_threshold: config.recovery_threshold ?? null, alert_rule_id: null,
        } : monitor?.config ?? {};
        if (Object.keys(config).length) await ctx.write(MONITOR, monitorId, {
          id: monitorId, _project: project.id, _organization: project._organization,
          slug, name: slug, config: monitorConfig, status: 'active', isMuted: false, isUpserting: true,
          dateCreated: monitor?.dateCreated ?? ctx.occurredAt, project: Object.fromEntries(Object.entries(ctx.own(project)).filter(([k]) => !k.startsWith('_'))),
          environments: [], owner: null, alertRule: null,
        }, monitor ? 'monitor.update' : 'monitor.create');
        // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/monitors/serializers.py "str(obj.guid)"
        const rawCheckInId = String(p.check_in_id ?? ctx.mint(CHECK_IN)).replace(/-/g, '');
        const checkInId = rawCheckInId.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
        const prior = ctx.row(CHECK_IN, checkInId);
        if (prior && p.status !== prior.status) ctx.legal(CHECK_IN, 'status', 'sendEnvelope', prior.status, String(p.status), checkInId, 'vendor');
        await ctx.write(CHECK_IN, checkInId, {
          id: checkInId, _monitor: monitor || Object.keys(config).length ? monitorId : null,
          status: p.status ?? null, duration: p.duration ?? prior?.duration ?? null, environment: p.environment ?? '',
          dateCreated: prior?.dateCreated ?? ctx.occurredAt, dateAdded: prior?.dateAdded ?? ctx.occurredAt, dateUpdated: ctx.occurredAt,
          dateInProgress: prior?.dateInProgress ?? (p.status === 'in_progress' ? ctx.occurredAt : null), dateClock: ctx.occurredAt, expectedTime: prior?.expectedTime ?? ctx.occurredAt,
          monitorConfig, groups: [],
        }, prior ? 'check_in.update' : 'check_in.create');
        await ctx.write('project', String(project.id), { hasMonitors: true }, 'project.update');
        break;
      }
      case 'log': for (const l of Array.isArray(p.items) ? p.items as Row[] : []) await ctx.record(LOG, { ...base, timestamp: typeof l.timestamp === 'number' ? new Date(l.timestamp * 1000).toISOString() : l.timestamp ?? null, level: l.level ?? null, body: l.body ?? null, trace_id: l.trace_id ?? null, attributes: obj(l.attributes) }, id(LOG)); break;
      case 'trace_metric': for (const m of Array.isArray(p.items) ? p.items as Row[] : []) await ctx.record(METRIC, { ...base, timestamp: m.timestamp ?? null, name: m.name ?? null, type: m.type ?? null, value: m.value ?? null, unit: m.unit ?? null, attributes: obj(m.attributes) }, id(METRIC)); break;
      // an item of a type the twin does not keep otherwise is skipped and retained as it came
      // source: https://raw.githubusercontent.com/getsentry/sentry-docs/3ec4e139711af82b38a3c2c17261f5f5cdb66dfc/develop-docs/sdk/foundations/envelopes/index.mdx "Implementations **must gracefully skip and retain** Items of unknown type"
      default: {
        const blob = `envelope-item/${String(project.id)}/${envelopeN}/${n}`;
        await ctx.blobs.put(blob, item.payload);
        await ctx.record(OTHER_ITEM, { ...base, type, header: item.header, size: item.payload.length, blob }, id(OTHER_ITEM));
      }
    }
  }
  return Response.json(envelopeId ? { id: envelopeId } : {});
}
