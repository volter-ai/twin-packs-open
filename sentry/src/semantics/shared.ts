// What every lane of Sentry shares (the API, ingest): its accounts, and what it keeps of what the SDKs send.
//
// Sentry's accounts: an organization, its projects, each project's client key
// (the DSN an SDK sends with), and the organization's auth tokens (what sentry-cli and an integration call the API
// with). Bootstrap makes the first project and credential; additional projects use createOrganizationProject.
//
// A DSN is `https://<public key>@o<organization id>.ingest.us.sentry.io/<project id>`
// (https://docs.sentry.io/concepts/key-terms/dsn-explainer/). An organization auth token is `sntrys_`, the base64 of what
// it is for, `_` and its secret (https://docs.sentry.io/account/auth-tokens/#organization-tokens); the World keeps a
// token by its SHA-256 and draws its secret from a secret it holds (ctx.secret), so no one computes it.
//
// What Sentry keeps of what the SDKs send (the ingest lane writes it, the API lane reads it): events (errors, messages,
// transactions, feedback) with the issues errors are grouped into, and the other kinds of envelope item (sessions,
// client reports, attachments, replays, profiles, cron check-ins and their monitors, logs, metrics). What no operation
// serves is bookkeeping (a `_` type, kept by ctx.record); both lanes are one service, so they share one store.
//
// The event's fields are the event payload's (https://develop.sentry.dev/sdk/foundations/envelopes/event-payloads/) as
// the API answers them (the spec's listProjectEvents and getProjectEvent schemas).
import type { HandlerContext } from '@volter/world-core';

type Reader = Pick<HandlerContext, 'row' | 'rowsRaw' | 'own'>;
export type Row = Record<string, unknown>;

/** An organization, made the first time (sentry.io's sign-up names it). */
export async function makeOrg(ctx: HandlerContext, slug: string, name: string, owner: string): Promise<Row | Response> {
  const made = await ctx.createUnique(ORG, { slug, name, _owner: owner, dateCreated: ctx.occurredAt, status: { id: 'active', name: 'active' }, avatar: { avatarType: 'letter_avatar', avatarUuid: null }, isEarlyAdopter: false, require2FA: false, hasAuthProvider: false, features: [...DEFAULT_FEATURES], links: { organizationUrl: `https://${slug}.sentry.io`, regionUrl: 'https://us.sentry.io' }, allowMemberInvite: true, allowMemberProjectCreation: true, allowSuperuserAccess: false }, 'organization.create');
  return made.created ? ctx.row(ORG, String(made.row.id))! : Response.json({ slug: ['An organization with this slug already exists.'] }, { status: 409 });
}

/** A project of an organization with its default client key (the project's creation makes one). */
export async function makeProject(ctx: HandlerContext, org: Row, slug: string, platform: string | null): Promise<Row | Response> {
  const made = await ctx.createUnique(PROJECT, { slug, name: slug, platform, _organization: org.id, dateCreated: ctx.occurredAt, _issueCounter: 0, isBookmarked: false, isMember: true, features: ['releases'], firstEvent: null, firstTransactionEvent: false, access: [], hasAccess: true, team: null, teams: [], environments: [], latestRelease: null, platforms: platform ? [platform] : [], hasSessions: false, hasProfiles: false, hasReplays: false, hasFlags: false, hasMinifiedStackTrace: false, hasMonitors: false, hasFeedbacks: false, hasNewFeedbacks: false, hasUserReports: false, hasInsightsHttp: false, hasInsightsDb: false, hasInsightsAssets: false, hasInsightsAppStart: false, hasInsightsScreenLoad: false, hasInsightsVitals: false, hasInsightsCaches: false, hasInsightsQueues: false, hasInsightsAgentMonitoring: false, hasInsightsMCP: false, hasLogs: false, hasTraceMetrics: false }, 'project.create');
  if (!made.created) return Response.json({ slug: ['A project with this slug already exists.'] }, { status: 409 });
  const project = ctx.row(PROJECT, String(made.row.id))!;
  await makeClientKey(ctx, org, project);
  return project;
}

export async function makeClientKey(ctx: HandlerContext, org: Row, project: Row): Promise<Row> {
  const id = String(project.id);
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/models/projectkey.py "secret_key = ProjectKey.generate_api_key()"
  const secret = ctx.crypto.digest('sha256', await ctx.secret(`sentry-project-key:${await next(ctx, 'project_key')}`), 'hex').slice(0, 32);
  const endpoint = `https://o${String(org.id)}.ingest.us.sentry.io`;
  const api = `${endpoint}/api/${id}`;
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/api/serializers/models/project_key.py "ProjectKeySerializerResponse"
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/projectoptions/defaults.py "sentry:default_loader_version"
  // New projects take the current option epoch's loader defaults; the installed application SDK is independent.
  const made = await ctx.create(CLIENT_KEY, (pub) => ({ id: pub, public: pub, secret, _project: id, name: 'Default', label: 'Default', projectId: Number(id), isActive: true, dateCreated: ctx.occurredAt, rateLimit: null,
    dsn: { public: `https://${pub}@${endpoint.slice(8)}/${id}`, secret: `https://${pub}:${secret}@${endpoint.slice(8)}/${id}`,
      csp: `${api}/csp-report/?sentry_key=${pub}`, security: `${api}/security/?sentry_key=${pub}`, minidump: `${api}/minidump/?sentry_key=${pub}`, nel: `${api}/nel/?sentry_key=${pub}`,
      playstation: `${api}/playstation/?sentry_key=${pub}`, integration: `${api}/integration/`, otlp_traces: `${api}/integration/otlp/v1/traces`, otlp_logs: `${api}/integration/otlp/v1/logs`, unreal: `${api}/unreal/${pub}/`, crons: `${api}/cron/___MONITOR_SLUG___/${pub}/`, cdn: `https://js.sentry-cdn.com/${pub}.min.js` },
    browserSdkVersion: '11.x', browserSdk: { choices: ['11.x', '10.x', '9.x', '8.x', '7.x'].map((v) => [v, v]) }, dynamicSdkLoaderOptions: { hasReplay: true, hasPerformance: true, hasDebug: false, hasFeedback: false, hasLogsAndMetrics: false },
  }), 'project_key.create');
  return ctx.row(CLIENT_KEY, String(made.id))!;
}

/** An organization auth token's value: `sntrys_`, the base64 of what it is for (when it was made, the API's and the
 *  region's URLs, the organization) and `_` and its secret, drawn from the World's secret under its label. */
async function tokenValue(ctx: Pick<HandlerContext, 'secret'>, org: Row, label: string, iat: number): Promise<string> {
  const claims = Buffer.from(JSON.stringify({ iat, url: 'https://sentry.io', region_url: 'https://us.sentry.io', org: org.slug })).toString('base64');
  const secret = (await ctx.secret(label)).replace(/[^A-Za-z0-9]/g, '').slice(0, 43);
  return `sntrys_${claims}_${secret}`;
}

/** An organization auth token, made on Settings > Auth Tokens: its value shown once. Its scopes are the organization
 *  token's fixed set ("org:ci": releases and source maps, and reading the organization). */
export async function makeOrgToken(ctx: HandlerContext, org: Row, name: string, scopes: string[] = ['org:ci']): Promise<string> {
  const label = `sentry-org-token:${String(org.id)}:${await next(ctx, 'token')}`;
  const iat = Math.floor(Date.parse(ctx.occurredAt) / 1000);
  const token = await tokenValue(ctx, org, label, iat);
  await ctx.record(TOKEN, { organization: org.id, name, scopes, kind: 'org', dateCreated: ctx.occurredAt, iat, label, lastChars: token.slice(-4) }, sha256(ctx, token));
  return token;
}

/** A live native auth token, reconstructed only while its stored digest still matches. */
export async function readToken(ctx: HandlerContext, org: Row, row: Row): Promise<string | undefined> {
  if (row.deleted === true || row.organization !== org.id) return undefined;
  const token = row.kind === 'personal' ? `sntryu_${ctx.crypto.digest('sha256', await ctx.secret(String(row.label)), 'hex')}` : await tokenValue(ctx, org, String(row.label), Number(row.iat));
  return sha256(ctx, token) === row.id ? token : undefined;
}

/** A personal token (User Settings > Personal Tokens): `sntryu_` and 64 hexadecimal digits, with the scopes chosen when it
 *  is made, acting on the organizations its user belongs to (here, the one named). */
export async function makePersonalToken(ctx: HandlerContext, org: Row, name: string, scopes: string[]): Promise<string> {
  const label = `sentry-personal-token:${await next(ctx, 'token')}`;
  const hex = ctx.crypto.digest('sha256', await ctx.secret(label), 'hex');
  const token = `sntryu_${hex}`;
  await ctx.record(TOKEN, { organization: org.id, user: org._owner, name, scopes, kind: 'personal', dateCreated: ctx.occurredAt, label, lastChars: token.slice(-4) }, sha256(ctx, token));
  return token;
}

/** The token a request's `Authorization: Bearer` names, if the World issued it and it is not revoked. */
export function bearerToken(ctx: Pick<HandlerContext, 'row' | 'crypto' | 'call'>): Row | undefined {
  const header = ctx.call.request.headers.get('authorization') ?? '';
  const value = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  return value ? live(ctx.row(TOKEN, sha256(ctx, value))) : undefined;
}

/** Whether a token's scopes grant one: the scope itself, one its `org:ci` implies, or the same resource's write or
 *  admin (a `:write` scope reads, an `:admin` one writes and reads). */
export function grants(token: Row, scope: string): boolean {
  const held = ((token.scopes as string[] | undefined) ?? []).flatMap((s) => [s, ...(IMPLIED[s] ?? [])]);
  const [resource] = scope.split(':');
  return held.includes(scope) || held.includes(`${resource}:admin`) || (scope.endsWith(':read') && held.includes(`${resource}:write`));
}

/** An event's time: its `timestamp` (RFC 3339 or seconds since the epoch), else when it was received. */
export function eventTime(payload: Row, received: string): string {
  const t = payload.timestamp;
  if (typeof t === 'number') return new Date(t * 1000).toISOString();
  if (typeof t === 'string' && !Number.isNaN(Date.parse(t))) return new Date(t).toISOString();
  return received;
}

/** The exception an error event names first (the last of `exception.values`, the one raised), if any. */
function exceptionOf(payload: Row): Row | undefined {
  const values = arr(obj(payload.exception).values ?? payload.exception);
  return values.length ? values[values.length - 1] : undefined;
}
function framesOf(exception: Row | undefined): Row[] { return arr(obj(exception?.stacktrace).frames); }
/** The frame an error is located at: the innermost in-app frame, else the innermost. */
function topFrame(frames: Row[]): Row | undefined {
  const inApp = frames.filter((f) => f.in_app === true);
  return (inApp.length ? inApp : frames).at(-1);
}
function messageOf(payload: Row): string {
  const m = payload.message ?? payload.logentry;
  if (typeof m === 'string') return m;
  const o = obj(m);
  return String(o.formatted ?? o.message ?? '');
}

/** An event's title, culprit, location and metadata, as Sentry derives them for its kind. Where the documentation stops:
 *  Sentry's own derivation (its event types' `get_title` and `get_location`) is code, not a page; these follow its
 *  answers' forms: `<Type>: <value>` for an error, the message for a message event, the transaction's name for one. */
export function derive(payload: Row, type: string): { title: string; culprit: string; location: string | null; metadata: Row } {
  if (type === 'transaction') {
    const name = String(payload.transaction ?? '<unlabeled transaction>');
    return { title: name, culprit: name, location: name, metadata: { title: name } };
  }
  if (type === 'feedback') {
    const f = obj(obj(payload.contexts).feedback);
    const message = String(f.message ?? '');
    return { title: 'User Feedback', culprit: 'user', location: null, metadata: { title: 'User Feedback', value: message, message, contact_email: f.contact_email ?? null, name: f.name ?? null } };
  }
  const ex = exceptionOf(payload);
  const frame = topFrame(framesOf(ex));
  const location = frame ? String(frame.filename ?? frame.abs_path ?? frame.module ?? '') || null : null;
  const culprit = String(payload.transaction ?? payload.culprit ?? (frame ? `${String(frame.function ?? '?')}(${String(frame.filename ?? frame.abs_path ?? '?')})` : ''));
  if (ex) {
    const exType = String(ex.type ?? 'Error');
    const value = String(ex.value ?? '');
    return { title: value ? `${exType}: ${value.split('\n')[0]}` : exType, culprit, location,
      metadata: { type: exType, value, ...(frame?.filename ? { filename: frame.filename } : {}), ...(frame?.function ? { function: frame.function } : {}), in_app_frame_mix: 'mixed' } };
  }
  const message = messageOf(payload) || '<unlabeled event>';
  return { title: message.split('\n')[0]!, culprit, location, metadata: { title: message.split('\n')[0]!, value: message } };
}

/** The hash an error groups by: its fingerprint when the SDK sends one of its own, else its exception's type and its
 *  in-app frames (or its type and value, with no stack trace), else its message. Where the documentation stops: Sentry
 *  groups by its grouping configuration (https://docs.sentry.io/concepts/data-management/event-grouping/), whose
 *  algorithm is not reproduced; this keeps its rule's shape: the stack trace first, then the exception, then the message. */
export function groupingHash(ctx: Pick<HandlerContext, 'crypto'>, payload: Row): string {
  const fp = Array.isArray(payload.fingerprint) ? (payload.fingerprint as unknown[]).map(String) : [];
  const own = fp.filter((f) => f !== '{{ default }}' && f !== '{{default}}');
  const ex = exceptionOf(payload);
  const frames = framesOf(ex).filter((f) => f.in_app !== false).map((f) => `${String(f.module ?? f.filename ?? '')}:${String(f.function ?? '')}`);
  const basis = own.length && own.length === fp.length ? ['fp', ...own]
    : ex ? (frames.length ? ['st', String(ex.type ?? ''), ...frames] : ['ex', String(ex.type ?? ''), String(ex.value ?? '')])
      : ['msg', messageOf(payload)];
  return ctx.crypto.digest('md5', JSON.stringify(basis), 'hex');
}

/** An event's tags as the API lists them: the SDK's own, and the ones Sentry derives from the event. */
export function tagsOf(payload: Row): Array<{ key: string; value: string }> {
  const out = new Map<string, string>();
  const own = payload.tags;
  if (Array.isArray(own)) for (const t of own) { if (Array.isArray(t)) out.set(String(t[0]), String(t[1])); }
  else for (const [k, v] of Object.entries(obj(own))) out.set(k, String(v));
  const put = (k: string, v: unknown): void => { if (v !== undefined && v !== null && v !== '' && !out.has(k)) out.set(k, String(v)); };
  put('level', payload.level ?? 'error');
  put('environment', payload.environment);
  put('release', payload.release);
  put('transaction', payload.transaction);
  put('server_name', payload.server_name);
  put('url', obj(payload.request).url);
  const user = obj(payload.user);
  put('user', user.email ? `email:${String(user.email)}` : user.id ? `id:${String(user.id)}` : user.ip_address ? `ip:${String(user.ip_address)}` : undefined);
  const ex = exceptionOf(payload);
  const mech = obj(ex?.mechanism);
  if (ex) { put('handled', mech.handled === false ? 'no' : 'yes'); put('mechanism', mech.type); }
  return [...out.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => a.key.localeCompare(b.key));
}
/** An issue's short id's number, as Sentry writes it: `<PROJECT>-<base32 of the project's issue count>` (models/group.py). */
function base32(n: number): string { let out = ''; let x = n; do { out = BASE32[x % 32] + out; x = Math.floor(x / 32); } while (x > 0); return out; }

/** An error or message event kept, grouped into its issue (made, or counted again). */
export async function keepEvent(ctx: HandlerContext, project: Row, payload: Row, type: string): Promise<Row> {
  const eventID = String(payload.event_id ?? '').replace(/-/g, '').toLowerCase() || ctx.mint(EVENT);
  const id = `${String(project.id)}:${eventID}`;
  const held = ctx.row(type === 'transaction' ? '_transaction' : EVENT, id);
  if (held && held.deleted !== true) return held;
  const when = eventTime(payload, ctx.occurredAt);
  const d = derive(payload, type);
  let groupID: string | null = null;
  if (type !== 'transaction') {
    const hash = type === 'feedback' ? `feedback:${eventID}` : groupingHash(ctx, payload);
    const issue = ctx.rowsRaw(ISSUE).find((i) => i.deleted !== true && i._project === project.id && i._hash === hash);
    const user = obj(payload.user);
    const userKey = String(user.id ?? user.email ?? user.ip_address ?? '');
    if (issue) {
      // the issue's users, one subject each, which its userCount counts
      if (userKey) await ctx.record(ISSUE_USER, { issue: issue.id, user: userKey }, `${String(issue.id)}:${userKey}`);
      const userCount = ctx.rowsRaw(ISSUE_USER).filter((u) => u.issue === issue.id).length;
      await ctx.write(ISSUE, String(issue.id), { count: String(Number(issue.count) + 1), userCount, lastSeen: when > String(issue.lastSeen) ? when : issue.lastSeen }, 'issue.update');
      groupID = String(issue.id);
    } else {
      const n = Number(project._issueCounter ?? 0) + 1;
      await ctx.write('project', String(project.id), { _issueCounter: n }, 'project.update');
      groupID = ctx.mint(ISSUE);
      await ctx.write(ISSUE, groupID, {
        id: groupID, shortId: `${String(project.slug).toUpperCase()}-${base32(n)}`, project: { id: project.id, name: project.name, slug: project.slug, platform: project.platform ?? null }, _project: project.id, _organization: project._organization, _hash: hash,
        title: d.title, culprit: d.culprit, level: String(payload.level ?? (type === 'feedback' ? 'info' : 'error')), status: 'unresolved', substatus: 'new',
        type: type === 'feedback' ? 'generic' : type === 'default' ? 'default' : 'error', issueType: type === 'feedback' ? 'feedback' : 'error', issueCategory: type === 'feedback' ? 'feedback' : 'error',
        metadata: d.metadata, count: '1', userCount: userKey ? 1 : 0, firstSeen: when, lastSeen: when, platform: payload.platform ?? project.platform ?? null,
      }, 'issue.create');
      const madeIssue = ctx.row(ISSUE, groupID)!;
      await ctx.write(ISSUE, groupID, issueView(ctx, madeIssue), 'issue.update');
      if (userKey) await ctx.record(ISSUE_USER, { issue: groupID, user: userKey }, `${groupID}:${userKey}`);
    }
  }
  const fields = {
    id: eventID, eventID, projectID: project.id, _project: project.id, _organization: project._organization, type, groupID, title: d.title, culprit: d.culprit, location: d.location, metadata: d.metadata,
    message: messageOf(payload), platform: payload.platform ?? null, dateCreated: when, dateReceived: ctx.occurredAt, tags: tagsOf(payload),
    user: Object.keys(obj(payload.user)).length ? obj(payload.user) : null, release: payload.release ?? null, _environment: payload.environment ?? null,
    _payload: payload,
  };
  const stored = type === 'transaction' ? await ctx.record('_transaction', fields, id) : await ctx.write(EVENT, id, { ...fields, ...fullEvent(ctx, fields) }, 'event.create');
  if (type !== 'transaction' && groupID) {
    const siblings = ctx.rowsRaw(EVENT).filter((e) => e.groupID === groupID).sort((a, b) => String(a.dateCreated).localeCompare(String(b.dateCreated)));
    for (let i = 0; i < siblings.length; i++) await ctx.write(EVENT, String(siblings[i]!.id), { previousEventID: siblings[i - 1]?.eventID ?? null, nextEventID: siblings[i + 1]?.eventID ?? null }, 'event.update');
  }
  await ctx.write(PROJECT, String(project.id), { ...(type === 'transaction' ? { firstTransactionEvent: true } : { firstEvent: project.firstEvent ?? when }), ...(type === 'feedback' ? { hasFeedbacks: true, hasNewFeedbacks: true } : {}), environments: [...new Set([...(project.environments as string[] ?? []), ...(payload.environment ? [String(payload.environment)] : [])])] }, 'project.update');
  return typeof stored === 'string' ? { ...fields, id: stored } : stored;
}

/** An event as a project's event list answers it (the spec's listProjectEvents item). */
export function simpleEvent(e: Row): Row {
  const user = e.user ? obj(e.user) : null;
  return {
    id: e.eventID, 'event.type': e.type, groupID: e.groupID ?? null, eventID: e.eventID, projectID: e.projectID, message: e.message ?? '', title: e.title,
    location: e.location ?? null, culprit: e.culprit ?? null,
    user: user ? { id: user.id ?? null, email: user.email ?? null, username: user.username ?? null, ip_address: user.ip_address ?? null, name: user.name ?? null, geo: user.geo ?? null, data: user.data ?? null } : null,
    tags: e.tags, platform: e.platform ?? null, dateCreated: e.dateCreated, crashFile: null, metadata: e.metadata ?? {},
  };
}

/** An event in full (the spec's getProjectEvent): the simple fields, its entries (the exception with its stack
 *  traces, the breadcrumbs, the request, the message), its contexts, SDK, release and neighbours. */
export function fullEvent(ctx: Reader, raw: Row): Row {
  const e = raw;
  const p = obj(raw._payload);
  const entries: Row[] = [];
  const ex = obj(p.exception);
  const values = arr(ex.values ?? p.exception);
  if (values.length) entries.push({ type: 'exception', data: { values: values.map((v) => ({ type: v.type ?? null, value: v.value ?? null, module: v.module ?? null, mechanism: v.mechanism ?? null, threadId: v.thread_id ?? null, rawStacktrace: null,
    stacktrace: v.stacktrace ? { frames: framesOf(v).map((f) => ({ filename: f.filename ?? null, absPath: f.abs_path ?? null, module: f.module ?? null, package: f.package ?? null, platform: f.platform ?? null, instructionAddr: null, symbolAddr: null, function: f.function ?? null, rawFunction: null, symbol: null, context: [...arr(f.pre_context).map((l, i, a) => [Number(f.lineno ?? 0) - a.length + i, l]), ...(f.context_line !== undefined ? [[f.lineno ?? null, f.context_line]] : []), ...arr(f.post_context).map((l, i) => [Number(f.lineno ?? 0) + i + 1, l])], lineNo: f.lineno ?? null, colNo: f.colno ?? null, inApp: f.in_app ?? false, trust: null, errors: null, lock: null, vars: f.vars ?? null })), framesOmitted: null, registers: null, hasSystemFrames: framesOf(v).some((f) => f.in_app !== true) } : null })), hasSystemFrames: false, excOmitted: null } });
  const crumbs = arr(obj(p.breadcrumbs).values ?? p.breadcrumbs);
  if (crumbs.length) entries.push({ type: 'breadcrumbs', data: { values: crumbs.map((b) => ({ type: b.type ?? 'default', timestamp: typeof b.timestamp === 'number' ? new Date(b.timestamp * 1000).toISOString() : b.timestamp ?? null, level: b.level ?? 'info', message: b.message ?? null, category: b.category ?? null, data: b.data ?? null, event_id: null })) } });
  const req = obj(p.request);
  if (Object.keys(req).length) entries.push({ type: 'request', data: { url: req.url ?? null, method: req.method ?? null, query: req.query_string ?? [], fragment: req.fragment ?? null, data: req.data ?? null, headers: Object.entries(obj(req.headers)), cookies: [], env: req.env ?? null, inferredContentType: null, apiTarget: null } });
  if (!values.length && e.message) entries.push({ type: 'message', data: { formatted: e.message, message: null, params: null } });
  const siblings = ctx.rowsRaw(EVENT).filter((x) => x.deleted !== true && x.groupID === e.groupID && e.groupID !== null).sort((a, b) => String(a.dateCreated).localeCompare(String(b.dateCreated)));
  const at = siblings.findIndex((x) => x.eventID === e.eventID);
  return {
    ...Object.fromEntries(Object.entries(simpleEvent(e)).filter(([key]) => key !== 'event.type')), size: JSON.stringify(p).length, entries, dist: p.dist ?? null, contexts: obj(p.contexts), sdk: p.sdk ?? null, context: obj(p.extra), packages: obj(p.modules),
    type: e.type, errors: [], occurrence: null, _meta: {}, dateReceived: e.dateReceived, fingerprints: [], groupingConfig: { id: 'newstyle:2023-01-11', enhancements: '' },
    release: e.release ? { version: e.release } : null, userReport: null, sdkUpdates: [], resolvedWith: [],
    nextEventID: at >= 0 && at < siblings.length - 1 ? siblings[at + 1]!.eventID : null, previousEventID: at > 0 ? siblings[at - 1]!.eventID : null,
  };
}

/** An issue as the API answers it (the spec's issue schema, its common fields). */
export function issueView(ctx: Reader, raw: Row): Row {
  const i = ctx.own(raw);
  const project = ctx.row('project', String(i._project));
  const org = project ? ctx.row('organization', String(project._organization)) : undefined;
  return {
    id: i.id, shareId: null, shortId: i.shortId, title: i.title, culprit: i.culprit,
    permalink: `https://${String(org?.slug ?? 'sentry')}.sentry.io/issues/${String(i.id)}/`, logger: null, level: i.level, status: i.status, substatus: i.substatus ?? null,
    statusDetails: {}, isPublic: false, platform: i.platform ?? null, project: project ? { id: project.id, name: project.name, slug: project.slug, platform: project.platform ?? null } : null,
    type: i.type, metadata: i.metadata, numComments: 0, assignedTo: null, isBookmarked: false, isSubscribed: false, subscriptionDetails: null, hasSeen: false, annotations: [],
    issueType: i.issueType, issueCategory: i.issueCategory, priority: 'medium', priorityLockedAt: null, isUnhandled: false,
    count: String(i.count), userCount: i.userCount, firstSeen: i.firstSeen, lastSeen: i.lastSeen,
  };
}

/** Stored vendor fields, including the API's own _meta; private association/payload fields stay in the tree. */
export function wire(ctx: Reader, row: Row): Row {
  return Object.fromEntries(Object.entries(ctx.own(row)).filter(([key]) => !key.startsWith('_') || key === '_meta'));
}

export const ORG = 'organization';
export const PROJECT = 'project';
export const CLIENT_KEY = 'project_key';
export const TOKEN = '_auth_token';

const live = (r: Row | undefined): Row | undefined => (r && r.deleted !== true ? r : undefined);

/** An id in Sentry's form: a number, as a string. Where the documentation stops: how Sentry mints its ids is not
 *  published; ctx.mint makes hash-derived decimal ids at the declared width, the same every run. */


export const orgBySlug = (ctx: Reader, ref: string): Row | undefined =>
  ctx.rowsRaw(ORG).find((o) => o.deleted !== true && (o.slug === ref || o.id === ref));
export const projectOf = (ctx: Reader, org: Row, ref: string): Row | undefined =>
  ctx.rowsRaw(PROJECT).find((p) => p.deleted !== true && p._organization === org.id && (p.slug === ref || p.id === ref));
export const projectById = (ctx: Reader, id: string): Row | undefined => live(ctx.row(PROJECT, id));

/** The host a DSN names for an organization. */
export const ingestHost = (org: Row): string => `o${String(org.id)}.ingest.us.sentry.io`;
/** A project's DSN, from its client key. */
export const dsnOf = (org: Row, project: Row, key: Row): string => `https://${String(key.public)}@${ingestHost(org)}/${String(project.id)}`;

/** A project's active client key. */
export const keyOf = (ctx: Reader, project: Row): Row | undefined =>
  ctx.rowsRaw(CLIENT_KEY).find((k) => k.deleted !== true && k._project === project.id && k.isActive !== false);
/** The project a DSN's public key belongs to. */
export const projectByKey = (ctx: Reader, publicKey: string): Row | undefined => {
  const key = ctx.rowsRaw(CLIENT_KEY).find((k) => k.deleted !== true && k.public === publicKey && k.isActive !== false);
  return key ? projectById(ctx, String(key._project)) : undefined;
};

const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v, 'hex');

// "Organization Tokens: ... have a limited set of permissions and are designed to be used in CI environments and with
// Sentry CLI" (docs.sentry.io/account/auth-tokens). Where the documentation stops: the set is Sentry's code's; the
// twin's `org:ci` reads the organization and makes releases and uploads source maps, which is what sentry-cli does.
const IMPLIED: Record<string, string[]> = { 'org:ci': ['org:read', 'project:releases'] };

/** The World's next number in a sequence (a project's id, a nonce): issued from the tree over the lane's declared
 *  `_seq_<what>` (ctx.issue), never a row count. */
export const next = async (ctx: Pick<HandlerContext, 'issue'>, what: string): Promise<number> => Number(await ctx.issue(`_seq_${what}`));

// ── what Sentry keeps of what the SDKs send ─────────────────────────────────────────────────────

export const EVENT = 'event';
export const ISSUE = 'issue';
/** One user an issue's events came from (its `userCount` counts them): bookkeeping the vendor serves only as the count. */
export const ISSUE_USER = '_issue_user';
export const SESSION = '_session';
export const CLIENT_REPORT = '_client_report';
export const ATTACHMENT = '_attachment';
export const REPLAY = '_replay';
export const PROFILE = '_profile';
export const MONITOR = 'monitor';
export const CHECK_IN = 'check_in';
export const LOG = '_log';
export const METRIC = '_metric';
export const OTHER_ITEM = '_envelope_item';

const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
const arr = (v: unknown): Row[] => (Array.isArray(v) ? v as Row[] : []);

// source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/utils/numbers.py "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// API-exposed organization features enabled by the pinned server default; no plan override is assumed.
const DEFAULT_FEATURES = [
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:advanced-search"
  "advanced-search",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:change-alerts"
  "change-alerts",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:crash-rate-alerts"
  "crash-rate-alerts",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:custom-symbol-sources"
  "custom-symbol-sources",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/temporary.py "organizations:dashboards-basic"
  "dashboards-basic",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/temporary.py "organizations:dashboards-edit"
  "dashboards-edit",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:data-forwarding"
  "data-forwarding",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:discover-basic"
  "discover-basic",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:discover-query"
  "discover-query",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:event-attachments"
  "event-attachments",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/temporary.py "organizations:insight-modules"
  "insight-modules",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:integrations-alert-rule"
  "integrations-alert-rule",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:integrations-chat-unfurl"
  "integrations-chat-unfurl",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:integrations-codeowners"
  "integrations-codeowners",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:integrations-enterprise-alert-rule"
  "integrations-enterprise-alert-rule",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:integrations-enterprise-incident-management"
  "integrations-enterprise-incident-management",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:integrations-event-hooks"
  "integrations-event-hooks",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:integrations-incident-management"
  "integrations-incident-management",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:integrations-issue-basic"
  "integrations-issue-basic",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:integrations-issue-sync"
  "integrations-issue-sync",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:integrations-scm-multi-org"
  "integrations-scm-multi-org",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:integrations-stacktrace-link"
  "integrations-stacktrace-link",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:integrations-ticket-rules"
  "integrations-ticket-rules",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:integrations-vercel"
  "integrations-vercel",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/temporary.py "organizations:invite-members"
  "invite-members",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:performance-view"
  "performance-view",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:relay"
  "relay",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/temporary.py "organizations:sentry-app-schema-form-migration"
  "sentry-app-schema-form-migration",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/temporary.py "organizations:session-replay-ui"
  "session-replay-ui",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:sso-basic"
  "sso-basic",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:sso-saml2"
  "sso-saml2",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:team-insights"
  "team-insights",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:team-roles"
  "team-roles",
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/features/permanent.py "organizations:uptime"
  "uptime",
];
