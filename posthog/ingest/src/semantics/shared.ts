// What every family of PostHog's ingest shares: the vendor's stored shapes (the api lane's manifest owns them) and the
// capture service's answers.
import { gunzip, s3, type DerivedManifest, type HandlerContext } from '@volter/world-core';
import { EVENT, obj, personEffects, projectByToken, type Row } from '../../../src/semantics/shared.ts';

export * from '../../../src/semantics/shared.ts';
export { manifest as apiManifest } from '../../../api/src/manifest.ts';

// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/api.rs "pub enum CaptureError {"
// The capture service answers a refusal as plain text, the error's message, with its status.
const refuse = (status: number, message: string): Response => new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/router.rs "pub const BATCH_BODY_SIZE: usize = 20 * 1024 * 1024; // 20MB"
const BATCH_BODY_SIZE = 20 * 1024 * 1024;

const b64 = (text: string): Uint8Array => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')), (c) => c.charCodeAt(0));
const isGzip = (b: Uint8Array): boolean => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/** The bytes as JSON: a form's `data`, then gzip where it is (posthog-node's Content-Encoding, posthog-js's
 *  `compression=gzip-js`), then base64 where it is (posthog-js's `compression=base64`); a string says why not. */
export async function decodeJson(request: Request, url: URL, bytes: Uint8Array): Promise<{ json: unknown } | { error: string }> {
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  let compression = (url.searchParams.get('compression') ?? '').toLowerCase();
  if (request.method !== 'GET' && type.startsWith('application/x-www-form-urlencoded')) {
    const form = new URLSearchParams(new TextDecoder().decode(bytes));
    compression = (form.get('compression') ?? compression).toLowerCase();
    bytes = new TextEncoder().encode(form.get('data') ?? '');
  }
  try {
    if (isGzip(bytes) || compression === 'gzip' || compression === 'gzip-js' || (request.headers.get('content-encoding') ?? '').toLowerCase() === 'gzip') bytes = await gunzip(bytes);
    let text = new TextDecoder().decode(bytes).trim();
    if (compression === 'base64' || (!text.startsWith('{') && !text.startsWith('['))) text = new TextDecoder().decode(b64(text)).trim();
    return { json: JSON.parse(text) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** The request's payload: the `data` of a GET or a form, base64 where it is, gzip where it is, as JSON. */
async function payloadOf(ctx: HandlerContext): Promise<unknown | Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  let bytes: Uint8Array;
  if (request.method === 'GET') {
    const data = url.searchParams.get('data');
    // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/api.rs "request missing data payload"
    if (!data) return refuse(400, 'request missing data payload');
    bytes = new TextEncoder().encode(data);
  } else bytes = s3.bytesOf(request);
  if (bytes.length > BATCH_BODY_SIZE) return refuse(413, `maximum event size exceeded: Request body exceeds limit of ${BATCH_BODY_SIZE} bytes`);
  const decoded = await decodeJson(request, url, bytes);
  return 'error' in decoded ? refuse(400, `failed to decode request: ${decoded.error}`) : decoded.json;
}

/** A token's shape as capture checks it; the token itself is not checked at the edge. */
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/token.rs "Check if a token is the right shape. It may not actually be a valid token!"
function tokenFault(token: string): string | undefined {
  if (token === '') return 'empty';
  if (token.length > 64) return 'too_long';
  if (!/^[\x00-\x7f]*$/.test(token)) return 'not_ascii';
  if (token.startsWith('phx_')) return 'personal_api_key';
  if (token.includes('\0')) return 'null_byte';
  return undefined;
}

/** An event's time as capture normalizes it: its `offset` back from now, else its `timestamp` less the client's clock
 *  skew (`sent_at` against now), else now; one more than 23 hours ahead is now. */
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/common/types/src/timestamp.rs "We subtract this from the client-provided timestamp to get"
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/common/types/src/timestamp.rs "const FUTURE_EVENT_HOURS_CUTOFF_MILLIS: i64 = 23 * 3600 * 1000; // 23 hours"
function eventTime(e: Row, sentAt: unknown, now: string, ignoreSentAt: boolean): string {
  const n = Date.parse(now);
  let t = n;
  const parsed = typeof e.timestamp === 'string' || typeof e.timestamp === 'number' ? Date.parse(typeof e.timestamp === 'number' ? new Date(e.timestamp).toISOString() : /(Z|[+-]\d\d:?\d\d)$/i.test(e.timestamp) ? e.timestamp : `${e.timestamp}Z`) : NaN;
  const sent = !ignoreSentAt && typeof sentAt === 'string' ? Date.parse(sentAt) : NaN;
  if (Number.isFinite(parsed)) t = Number.isFinite(sent) ? parsed - (sent - n) : parsed;
  if (typeof e.offset === 'number') t = n - e.offset;
  if (t - n > 23 * 3600 * 1000) t = n;
  return new Date(t).toISOString();
}

/** Capture: the payload's events checked as the capture service checks them, then each kept with its person effects
 *  under the project its token names. A token no project holds is accepted and its events dropped, as the service
 *  accepts any token of the right shape. */
export async function capture(ctx: HandlerContext, api: DerivedManifest): Promise<Response> {
  const url = new URL(ctx.call.request.url);
  const payload = await payloadOf(ctx);
  if (payload instanceof Response) return payload;
  const top = obj(payload);
  const raw: unknown[] = Array.isArray(payload) ? payload : Array.isArray(top.batch) ? top.batch : [payload];
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/api.rs "request holds no event"
  if (!raw.length) return refuse(400, 'request holds no event');
  const events = raw.map(obj);
  const tokens = new Set(events.map((e) => e.api_key ?? e.token ?? obj(e.properties).token ?? top.api_key ?? top.token).filter((t) => t !== undefined && t !== null).map(String));
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/api.rs "event submitted without an api_key"
  if (tokens.size === 0) return refuse(401, 'event submitted without an api_key');
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/api.rs "batch submitted with inconsistent api_key values"
  if (tokens.size > 1) return refuse(401, 'batch submitted with inconsistent api_key values');
  const token = [...tokens][0]!;
  const fault = tokenFault(token);
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/api.rs "API key is not valid: {0}"
  if (fault) return refuse(401, `API key is not valid: ${fault}`);
  for (const e of events) {
    // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/api.rs "event submitted with an empty event name"
    if (typeof e.event !== 'string' || e.event === '') return refuse(400, 'event submitted with an empty event name');
    const distinct = e.distinct_id ?? obj(e.properties).distinct_id ?? obj(e.properties).$distinct_id;
    // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/api.rs "event submitted without a distinct_id"
    if (distinct === undefined || distinct === null || String(distinct) === '') return refuse(400, 'event submitted without a distinct_id');
  }
  const over = await ctx.over(api);
  const project = projectByToken(over, token);
  if (project) {
    const sentAt = top.sent_at ?? (url.searchParams.get('_') ? new Date(Number(url.searchParams.get('_'))).toISOString() : undefined);
    for (const e of events) {
      const distinctId = String(e.distinct_id ?? obj(e.properties).distinct_id ?? obj(e.properties).$distinct_id);
      const properties = obj(e.properties);
      const timestamp = eventTime(e, sentAt, over.occurredAt, top.historical_migration === true || properties.$ignore_sent_at === true);
      const id = typeof e.uuid === 'string' && e.uuid ? e.uuid.toLowerCase() : over.mint(EVENT);
      // an event already kept under its uuid is not kept again (a retried batch)
      if (over.row(EVENT, id)) continue;
      const person = await personEffects(over, project, { ...e, distinct_id: distinctId }, timestamp);
      await over.write(EVENT, id, {
        id, event: e.event, distinct_id: distinctId, properties, timestamp, elements: [], elements_chain: typeof properties.$elements_chain === 'string' ? properties.$elements_chain : '',
        _project: String(project.id), _person: person?.id ?? null, _payload: e, _sent_at: sentAt ?? null, _received: over.occurredAt,
      }, 'event.capture');
    }
  }
  // source: spec:captureBatch "true or 1 returns 204 without a body"
  if (['1', 'true'].includes(url.searchParams.get('beacon') ?? '')) return new Response(null, { status: 204 });
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/api.rs "CaptureResponseCode::Ok => (StatusCode::OK, Json(self)).into_response(),"
  return Response.json({ status: 'Ok' });
}

// ── the project's remote config (config.ts, flags.ts) ──────────────────────────────────────────
// Django's RemoteConfig builds it from the project's settings (posthog/models/remote_config.py `build_config`) and
// caches it whenever the project is saved; the World holds the project, so it holds its config, at the settings the
// project holds: PostHog's defaults for a project nobody has configured (the World has no operation that changes them).

/** A project setting as the project holds it, else the Team model's default for it. */
const setting = (project: Row, field: string, fallback: unknown): unknown => (project[field] === undefined ? fallback : project[field]);

/** The project's remote config as the cache holds it, before the server sanitizes it for a client. */
function buildConfig(project: Row): Record<string, unknown> {
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/models/team/team.py "capture_performance_opt_in = field_access_control("
  const performance = setting(project, 'capture_performance_opt_in', true) === true;
  const webVitals = setting(project, 'autocapture_web_vitals_opt_in', null) === true;
  const logs = (setting(project, 'logs_settings', null) ?? {}) as Record<string, unknown>;
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/models/remote_config.py "\"supportedCompression\": [\"gzip\", \"gzip-js\"],"
  return {
    supportedCompression: ['gzip', 'gzip-js'],
    // The project's flags: none (flags.ts), so the active-flag query finds none.
    // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/models/remote_config.py "\"hasFeatureFlags\": FeatureFlag.objects.filter(team=team, active=True).exists(),"
    hasFeatureFlags: false,
    captureDeadClicks: setting(project, 'capture_dead_clicks', false) === true,
    // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/models/remote_config.py "if team.capture_performance_opt_in or team.autocapture_web_vitals_opt_in"
    capturePerformance: performance || webVitals
      ? { network_timing: performance, web_vitals: webVitals, web_vitals_allowed_metrics: setting(project, 'autocapture_web_vitals_allowed_metrics', null) }
      : false,
    autocapture_opt_out: setting(project, 'autocapture_opt_out', null) === true,
    autocaptureExceptions: setting(project, 'autocapture_exceptions_opt_in', null) === true,
    // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/settings/ingestion.py "NEW_ANALYTICS_CAPTURE_ENDPOINT = os.getenv(\"NEW_CAPTURE_ENDPOINT\", \"/i/v0/e/\")"
    analytics: { endpoint: '/i/v0/e/' },
    // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/models/remote_config.py "config[\"elementsChainAsString\"] = True"
    elementsChainAsString: true,
    // The World holds no suppression rule and no push integration.
    // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/products/error_tracking/backend/remote_config.py "\"suppressionRules\": get_client_safe_suppression_rules(team.id),"
    errorTracking: { autocaptureExceptions: setting(project, 'autocapture_exceptions_opt_in', null) === true, suppressionRules: [] },
    // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/products/messaging/backend/remote_config.py "return {\"appIds\": app_ids}"
    push: { appIds: [] },
    // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/models/remote_config.py "\"captureConsoleLogs\": logs_settings.get(\"capture_console_logs\", False),"
    logs: { captureConsoleLogs: logs.capture_console_logs === true },
    // Recording, heatmaps, conversations, surveys and product tours are each off until the project opts in.
    // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/models/remote_config.py "session_recording_config_response: bool | dict = False"
    sessionRecording: false,
    heatmaps: false,
    conversations: false,
    surveys: false,
    productTours: false,
    // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/models/remote_config.py "config[\"defaultIdentifiedOnly\"] = True"
    defaultIdentifiedOnly: true,
    siteApps: [],
    siteAppsJS: [],
  };
}

/** The config a client is answered (the cache's, sanitized: no siteAppsJS and no token), its keys in serde_json's
 *  default (sorted) order, as the server serializes the cached value. */
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/hypercache-server/src/sanitize.rs "obj.remove(\"siteAppsJS\");"
export function clientConfig(project: Row): Record<string, unknown> {
  const { siteAppsJS: _js, ...config } = buildConfig(project);
  return Object.fromEntries(Object.entries(config).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
