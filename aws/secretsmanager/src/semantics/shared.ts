// What Secrets Manager's handlers, its door and its front (../fetch.ts) share: a secret as it is kept (DescribeSecret's
// shape under its ARN, in the Region the ARN names; its versions, `_versions`, and resource policy, `_policy`, bookkeeping
// on it), the Region a request is made in (its signature's credential scope), the World clock read in epoch seconds, a
// staging label's move, a write its replicas mirror, a secret's rotation schedule, and the rotations Secrets Manager
// starts as the World clock makes them due.
export * from '../../../src/semantics/shared.ts';
import { type HandlerContext } from '@volter/world-core';

// source: spec:/shapes/com.amazonaws.secretsmanager#DescribeSecretResponse/members/VersionIdsToStages "A list of the versions of the secret that have staging labels attached."
export const versionStages = (versions: Version[]): Row => Object.fromEntries(versions.filter((v) => v.VersionStages.length).map((v) => [v.VersionId, v.VersionStages]));

/** The World clock at this call, in epoch seconds (Secrets Manager's dates are). */
// source: spec:/shapes/com.amazonaws.secretsmanager#SecretVersionsListEntry/members/CreatedDate "The date and time this version of the secret was created."
export const now = (ctx: Pick<HandlerContext, 'occurredAt'>): number => Math.floor(Date.parse(ctx.occurredAt) / 1000);

export type Row = Record<string, unknown>;

export type Version = { VersionId: string; VersionStages: string[]; CreatedDate: number; SecretString?: string; SecretBinary?: string; LastAccessedDate?: number };

export const S = 'Secret';

export const answer = (ctx: HandlerContext, body: Row): Response => ctx.raw(JSON.stringify(body), { headers: { 'content-type': 'application/x-amz-json-1.1' } });

/** The Region a request is signed for: its credential scope's third part. */
export const regionOf = (ctx: HandlerContext): string => /Credential=[^/]+\/\d+\/([a-z0-9-]+)\//.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1] ?? 'us-east-1';

export const regionOfArn = (arn: unknown): string => String(arn).split(':')[3] ?? '';

export const versionsOf = (row: Row): Version[] => ((row._versions as Version[] | undefined) ?? []).map((v) => ({ ...v, VersionStages: [...v.VersionStages] }));

/** A secret whose recovery window has ended is deleted permanently: "At the end of the recovery window,
 *  Secrets Manager deletes the secret permanently" (docs.aws.amazon.com/secretsmanager/latest/apireference/API_DeleteSecret.html).
 *  The window's end is the DeletionDate DeleteSecret answered, read on the World clock. */
// source: spec:/shapes/com.amazonaws.secretsmanager#DeleteSecret "At the end of the recovery window, Secrets Manager deletes the secret permanently."
export const purged = (ctx: HandlerContext, r: Row): boolean => r._deletionDate != null && now(ctx) >= Number(r._deletionDate);

/** The secrets that stand: not deleted, and not past their recovery window. */
export const kept = (ctx: HandlerContext): Row[] => ctx.rowsRaw(S).filter((r) => !purged(ctx, r));

/** The secret a SecretId names in the request's Region: by name, ARN, or ARN without its suffix. */
// source: spec:/shapes/com.amazonaws.secretsmanager#GetSecretValueRequest/members/SecretId "The ARN or name of the secret to retrieve."
export function find(ctx: HandlerContext, id: unknown, region = regionOf(ctx)): Row | undefined {
  return kept(ctx).find((r) => regionOfArn(r.ARN) === region && (r.Name === id || r.ARN === id || String(r.ARN).startsWith(`${String(id)}-`)));
}

/** A secret's rotation schedule (below, "rotation schedules"). Its RotationRules were accepted by RotateSecret, so they read as one. */
export const scheduleFor = (rules: unknown): Schedule => {
  const s = scheduleOf((rules as Row | undefined) ?? {});
  return typeof s === 'string' ? (scheduleOf({}) as Schedule) : s;
};

/** A generated version id is issued by the kernel and reserved in its bookkeeping type. */
// source: spec:/shapes/com.amazonaws.secretsmanager#PutSecretValueRequest/members/ClientRequestToken "of the new version."
export const mintVersion = (ctx: HandlerContext): Promise<string> => ctx.issue('_version');

/** Put a staging label on a version, taking it off whichever held it. AWSCURRENT's last holder keeps
 *  the secret's previous value as AWSPREVIOUS. */
// source: spec:/shapes/com.amazonaws.secretsmanager#UpdateSecretVersionStage "Each staging label can be attached to only one version at a time."
export function stage(versions: Version[], label: string, to: string): Version[] {
  const from = versions.find((v) => v.VersionStages.includes(label) && v.VersionId !== to);
  const out = versions.map((v) => ({ ...v, VersionStages: v.VersionStages.filter((s) => s !== label && !(label === 'AWSCURRENT' && from && s === 'AWSPREVIOUS')) }));
  for (const v of out) {
    if (v.VersionId === to) v.VersionStages.push(label);
    if (label === 'AWSCURRENT' && from && v.VersionId === from.VersionId) v.VersionStages.push('AWSPREVIOUS');
  }
  return out;
}

/** Write a secret, and the value, description and tags its replicas mirror. */
export async function save(ctx: HandlerContext, row: Row, fields: Row, operation: string): Promise<Row> {
  fields = { ...fields, ...(Array.isArray(fields._versions) ? { VersionIdsToStages: versionStages(fields._versions as Version[]) } : {}) };
  const next: Row = { ...row, ...fields, LastChangedDate: now(ctx) };
  await ctx.write(S, String(row.id), { ...fields, LastChangedDate: next.LastChangedDate }, operation);
  for (const status of (next.ReplicationStatus as Array<{ Region: string }> | undefined) ?? []) {
    const replica = find(ctx, next.Name, status.Region);
    if (replica) await ctx.write(S, String(replica.id), { _versions: next._versions, VersionIdsToStages: next.VersionIdsToStages, Description: next.Description, Tags: next.Tags, ...('_policy' in next ? { _policy: next._policy } : {}), LastChangedDate: next.LastChangedDate }, 'secret.replicate');
  }
  return next;
}

// ── rotation's invocations ──────────────────────────────────────────────────────────────────────
// Secrets Manager rotates a secret by invoking its rotation function once per step, each time with
// { Step, SecretId, ClientRequestToken, RotationToken } (docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_lambda.html).
// No World runs the function, so the twin keeps each invocation it would send (`_invocations`) and serves them at
// its own door, GET /_twin/rotation-invocations?secret=<id>[&step=<Step>], newest first: the function's steps read
// their event there. The rotation in progress (`_rotation`) holds its tokens, and the opening of the last window it was
// invoked in (-1 for none), until finishSecret completes it.
// source: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_lambda.html "The rotation step: create_secret , set_secret , test_secret , or finish_secret ."
export const STEPS = ['create_secret', 'set_secret', 'test_secret', 'finish_secret'];

/** The invocations a rotation sends at `at`: its tokens, or new ones minted for it. */
// source: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_lambda.html "A unique identifier that indicates the source of the request."
export async function invoke(ctx: HandlerContext, row: Row, at: number, steps: string[], tokens?: { ClientRequestToken: string; RotationToken: string }, window?: number): Promise<Row> {
  const ClientRequestToken = tokens?.ClientRequestToken ?? await mintVersion(ctx);
  const RotationToken = tokens?.RotationToken ?? await ctx.secret(`rotation-token:${await ctx.issue('_rotation')}`);
  const had = versionsOf(row);
  // the rotation's version carries AWSPENDING, taken off whichever version held it (a finished rotation may leave it on
  // AWSCURRENT's): one label is on one version
  // source: spec:/shapes/com.amazonaws.secretsmanager#DescribeSecretResponse/members/VersionIdsToStages "During rotation, Secrets Manager creates an"
  const versions = steps.length > 1 ? stage(had.some((v) => v.VersionId === ClientRequestToken) ? had : [...had, { VersionId: ClientRequestToken, VersionStages: [], CreatedDate: at }], 'AWSPENDING', ClientRequestToken) : had;
  const events = steps.map((Step) => ({ Step, SecretId: row.ARN, ClientRequestToken, RotationToken, InvokedAt: at }));
  return { _invocations: [...((row._invocations as Row[] | undefined) ?? []), ...events], ...(steps.length > 1 ? { _versions: versions, VersionIdsToStages: versionStages(versions), _rotation: { ClientRequestToken, RotationToken, window: window ?? -1 } } : {}) };
}

/** The scheduled rotations the World clock has made due, started as Secrets Manager starts them, before anything is
 *  answered: the next window is the one NextRotationDate closes, the windows after it follow from the schedule
 *  (below, "rotation schedules"), and Secrets Manager "rotates your secret at any time during the rotation window"
 *  (docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html#rotate-secrets_rotation-windows).
 *  Each invocation is stamped when it fell due: the window's opening, or the moment rotation was turned on if the
 *  window was already open. A rotation still unfinished when a later window of the schedule opens is invoked again
 *  then, with the same tokens: "Secrets Manager retries the entire rotation process multiple times during the open
 *  rotation windows" (docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_lambda.html). */
// source: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_lambda.html "If any rotation step fails, Secrets Manager retries the entire rotation process multiple times during the open rotation windows on the secret."
export async function catchUpRotations(ctx: HandlerContext): Promise<void> {
  const moment = now(ctx);
  for (const row of kept(ctx)) {
    if (row.RotationEnabled !== true || row.NextRotationDate == null) continue;
    if (row.PrimaryRegion && row.PrimaryRegion !== regionOfArn(row.ARN)) continue;
    const s = scheduleFor(row.RotationRules);
    const first = openingOf(s, Number(row.NextRotationDate));
    let rotating = row._rotation as { ClientRequestToken: string; RotationToken: string; window: number } | undefined;
    let fields: Row = {};
    let current: Row = row;
    for (let open = rotating && rotating.window >= 0 ? following(s, rotating.window) : first; open <= moment; open = following(s, open)) {
      const at = open === first ? Math.max(first, Number(row._scheduledAt ?? 0)) : open;
      fields = await invoke(ctx, current, at, STEPS, rotating, open);
      current = { ...current, ...fields };
      rotating = current._rotation as typeof rotating;
    }
    // the new version reaches the replicas as every write's does
    if (fields._invocations) await save(ctx, row, fields, 'secret.rotation_start');
  }
}

/** Complete the simulated replica creation on the World clock, storing the vendor's changed status. */
// source: spec:/shapes/com.amazonaws.secretsmanager#CreateSecretResponse/members/ReplicationStatus "which indicates that the replica was created."
export async function catchUpReplicas(ctx: HandlerContext): Promise<void> {
  // where the documentation stops: AWS gives no completion latency; this simulation uses five minutes.
  const syncSeconds = 300;
  for (const row of kept(ctx)) {
    const status = row.ReplicationStatus as Row[] | undefined;
    const completed = status?.map((s) => {
      if (s.Status !== 'InProgress') return s;
      const replica = find(ctx, row.Name, String(s.Region));
      return replica && now(ctx) >= Number(replica._replicatedAt) + syncSeconds ? { ...s, Status: 'InSync', StatusMessage: 'Replication succeeded' } : s;
    });
    if (completed?.some((s, i) => s !== status![i])) await ctx.write(S, String(row.id), { ReplicationStatus: completed }, 'secret.replication_complete');
  }
}

// ── rotation schedules ─────────────────────────────────────────────────────────────────────────
// A secret's rotation schedule, read from its RotationRules: AutomaticallyAfterDays, or a ScheduleExpression (`rate()` or
// Secrets Manager's restricted `cron()`), and the Duration of each rotation window
// (docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html,
// docs.aws.amazon.com/secretsmanager/latest/apireference/API_RotationRulesType.html). Times are epoch seconds, UTC:
// "Secrets Manager rotation schedules use UTC time zone", and "rotation windows always start on the hour".
//
// A schedule in days (AutomaticallyAfterDays, `rate(N days)`) opens its window at midnight and counts from the previous
// rotation ("Secrets Manager calculates the next rotation date based on the previous rotation", RotationRulesType). A
// cron schedule opens at its matching hours whatever the previous rotation was. A `rate(N hours)` opens "at midnight"
// (RotationRulesType, ScheduleExpression) and every N hours after, a grid that, as a cron expression's increments of
// hours do, "resets each day"; that it counts from the previous rotation as a days rate does is the twin's decision.

type Cron = { hours: number[]; months: Set<number>; day: (y: number, m: number, d: number) => boolean };
export type Schedule =
  | { kind: 'days' | 'hours'; every: number; duration?: number }
  | { kind: 'cron'; cron: Cron; duration?: number };

/** Whether a cron schedule rotates on the UTC day that starts at `midnight`. */
function cronDay(cron: Cron, midnight: number): boolean {
  const date = new Date(midnight * 1000);
  const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  return cron.months.has(m) && cron.day(y, m, d);
}

const HOUR = 3_600;
const DAY = 86_400;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
// how far a cron schedule is walked for its shortest gap: four years hold every calendar it can match ("Secrets Manager does not support rotation schedules that are more than a year apart")
// source: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html "Secrets Manager does not support rotation schedules that are more than a year apart"
const HORIZON_DAYS = 1_461;

const floorDay = (t: number): number => Math.floor(t / DAY) * DAY;
const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** One value of a field, a number or (for months and days of the week) a name. */
function value(token: string, min: number, max: number, names?: string[]): number | undefined {
  const named = names?.indexOf(token.toUpperCase()) ?? -1;
  const n = named >= 0 ? named + min : /^\d+$/.test(token) ? Number(token) : NaN;
  return n >= min && n <= max ? n : undefined;
}

/** The values one comma-separated item names: `*`, `a`, `a-b`, and each with a `/` increment (`/8` starting at the
 *  field's first value, as `cron(0 /8 * * ? *)` means every eight hours starting at midnight). */
// source: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html "Use / (forward slash) to specify increments."
function values(item: string, min: number, max: number, names?: string[]): number[] | undefined {
  const [base = '', inc, extra] = item.split('/');
  if (extra !== undefined || (inc !== undefined && !/^[1-9]\d*$/.test(inc)) || (base === '' && inc === undefined)) return undefined;
  let lo: number | undefined = min;
  let hi: number | undefined = max;
  if (base.includes('-')) [lo, hi] = base.split('-').length === 2 ? base.split('-').map((v) => value(v, min, max, names)) : [];
  else if (base !== '*' && base !== '') { lo = value(base, min, max, names); hi = inc === undefined ? lo : max; }
  if (lo === undefined || hi === undefined || lo > hi) return undefined;
  const out: number[] = [];
  for (let v = lo; v <= hi; v += Number(inc ?? 1)) out.push(v);
  return out;
}

/** A field's values as a set, or undefined when an item does not parse. */
function field(text: string, min: number, max: number, names?: string[]): Set<number> | undefined {
  const out = new Set<number>();
  for (const item of text.split(',')) {
    const vs = values(item, min, max, names);
    if (!vs) return undefined;
    vs.forEach((v) => out.add(v));
  }
  return out;
}

type DayTest = (y: number, m: number, d: number, weekday: number) => boolean;

/** The last named day of the month, `<DAY>L` (`SUNL`, "the last Sunday of the month"). */
// source: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html "last Sunday of the month"
function lastNamed(item: string): DayTest | undefined {
  const named = /^(.+)L$/.exec(item);
  const w = named ? value(named[1]!, 1, 7, DAYS) : undefined;
  return w === undefined ? undefined : (y, m, d, weekday) => weekday === w && d + 7 > lastDay(y, m);
}

/** Day-of-month: 1–31 with `, - * /`, `L` for the month's last day, `<DAY>L` for its last named day. */
// source: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html "Day-of-month"
function dayOfMonth(text: string): DayTest | undefined {
  const tests: DayTest[] = [];
  for (const item of text.split(',')) {
    const named = lastNamed(item);
    const vs = item === 'L' || named ? [] : values(item, 1, 31);
    if (!vs) return undefined;
    tests.push(item === 'L' ? (y, m, d) => d === lastDay(y, m) : named ?? ((_y, _m, d) => vs.includes(d)));
  }
  return (y, m, d, w) => tests.some((t) => t(y, m, d, w));
}

/** Day-of-week: 1–7 or SUN–SAT with `, - * /`, `<DAY>#n` for the month's nth such day, `L` for the week's last day,
 *  `<DAY>L` for the month's last such day. */
// source: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html "Day-of-week"
function dayOfWeek(text: string): DayTest | undefined {
  const tests: DayTest[] = [];
  for (const item of text.split(',')) {
    const nth = /^([^#]+)#([1-5])$/.exec(item);
    const named = item === 'L' ? undefined : lastNamed(item);
    if (nth) {
      const w = value(nth[1]!, 1, 7, DAYS);
      if (w === undefined) return undefined;
      tests.push((_y, _m, d, weekday) => weekday === w && Math.ceil(d / 7) === Number(nth[2]));
    } else if (item === 'L') tests.push((_y, _m, _d, weekday) => weekday === 7);
    else if (named) tests.push(named);
    else {
      const vs = values(item, 1, 7, DAYS);
      if (!vs) return undefined;
      tests.push((_y, _m, _d, weekday) => vs.includes(weekday));
    }
  }
  return (y, m, d, w) => tests.some((t) => t(y, m, d, w));
}

/** `cron(Minutes Hours Day-of-month Month Day-of-week Year)` as Secrets Manager restricts it, or why it is refused. */
function cronOf(body: string): Cron | string {
  const parts = body.trim().split(/\s+/);
  if (parts.length !== 6) return 'A cron expression has six fields: Minutes Hours Day-of-month Month Day-of-week Year.';
  const [minutes, hoursText, dom, monthText, dow, year] = parts as [string, string, string, string, string, string];
  // "A cron expression for Secrets Manager must have 0 in the minutes field because Secrets Manager rotation windows
  // start on the hour. It must have * in the year field"
// source: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html "A cron expression for Secrets Manager must have 0 in the minutes field because Secrets Manager rotation windows start on the hour."
  if (minutes !== '0') return 'The minutes field of a cron expression must be 0.';
// source: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html "It must have * in the year field"
  if (year !== '*') return 'The year field of a cron expression must be *.';
  // "If you specify a value in one of the fields, you must use a ? (question mark) in the other."
// source: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html "If you specify a value in one of the fields, you must use a ? (question mark) in the other."
  if ((dom === '?') === (dow === '?')) return 'Use ? in exactly one of the Day-of-month and Day-of-week fields.';
  const hours = field(hoursText, 0, 23);
  const months = field(monthText, 1, 12, MONTHS);
  const day = dom === '?' ? dayOfWeek(dow) : dayOfMonth(dom);
  if (!hours || !months || !day) return `Invalid cron expression: cron(${body}).`;
  return { hours: [...hours].sort((a, b) => a - b), months, day: (y, m, d) => day(y, m, d, new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 1) };
}

/** Whether a schedule is one in hours: its windows may open more than once a day. */
const inHours = (s: Schedule): boolean => (s.kind === 'cron' ? s.cron.hours.length > 1 : s.kind === 'hours');

/** The hours of the day a `rate(N hours)` opens at: midnight, and every N hours after until the day resets. */
const grid = (every: number): number[] => Array.from({ length: Math.ceil(DAY / every) }, (_, i) => (i * every) / HOUR);

/** The first window of a schedule opening at or after `t`, ignoring the previous rotation. A schedule RotateSecret
 *  accepted matches a day within HORIZON_DAYS of any day (windowRefused), so the walk ends. */
export function opening(s: Schedule, t: number): number {
  const hours = s.kind === 'cron' ? s.cron.hours : s.kind === 'hours' ? grid(s.every) : [0];
  for (let day = floorDay(t); ; day += DAY) {
    const hour = s.kind === 'cron' && !cronDay(s.cron, day) ? undefined : hours.find((h) => day + h * HOUR >= t);
    if (hour !== undefined) return day + hour * HOUR;
  }
}

/** The last second of the window opening at `open`: open plus Duration, which by default closes "after one hour for a
 *  rotation schedule in hours, and at the end of the day for a rotation schedule in days". NextRotationDate is that
 *  second (API_DescribeSecret.html's example: `cron(0 16 1,15 * ? *)` with Duration 2h answers 1665165599, 17:59:59). */
// source: spec:/shapes/com.amazonaws.secretsmanager#RotationRulesType/members/Duration "the window automatically closes after one hour."
export function closing(s: Schedule, open: number): number {
  const hours = s.duration ?? (inHours(s) ? 1 : 24 - (open - floorDay(open)) / HOUR);
  return open + hours * HOUR - 1;
}

/** The next window: a days or hours schedule's counted on from the previous rotation, a cron schedule's the next it
 *  matches. A window that is open now (opened today, not yet closed) is the next one; AWS documents no rule for a date
 *  already passed when rotation is turned on, and the twin decides the window open now or the next after it. */
// source: spec:/shapes/com.amazonaws.secretsmanager#RotationRulesType/members/AutomaticallyAfterDays "Secrets Manager calculates the next rotation date based on the previous rotation."
export function due(s: Schedule, previous: number, now: number): number {
  const counted = s.kind === 'cron' ? -Infinity : s.kind === 'days' ? floorDay(previous) + s.every : Math.floor(previous / HOUR) * HOUR + s.every;
  let open = opening(s, Math.max(counted, floorDay(now)));
  while (closing(s, open) < now) open = opening(s, open + HOUR);
  return open;
}

/** The window after the one opening at `open`, no rotation having finished in between. */
export const following = (s: Schedule, open: number): number => opening(s, open + (s.kind === 'cron' ? HOUR : s.every));

/** The opening of the window a NextRotationDate closes. */
export function openingOf(s: Schedule, close: number): number {
  const day = floorDay(close);
  for (let t = day; t < day + DAY; t += HOUR) if (opening(s, t) === t && closing(s, t) === close) return t;
  return day;
}

/** A schedule in the RotationRules RotateSecret accepts, or why RotateSecret refuses them. Unset, a secret rotates every
 *  30 days, as the twin has always decided. */
export function scheduleOf(rules: Row): Schedule | string {
  const expression = rules.ScheduleExpression;
  // "In RotateSecret, you can set the rotation schedule in RotationRules with AutomaticallyAfterDays or
  // ScheduleExpression, but not both" (RotationRulesType)
// source: spec:/shapes/com.amazonaws.secretsmanager#RotationRulesType/members/AutomaticallyAfterDays "but not both."
  if (expression !== undefined && rules.AutomaticallyAfterDays !== undefined) return 'You can set AutomaticallyAfterDays or ScheduleExpression, but not both.';
  // Duration: "Pattern: [0-9]+h"; "You can set the rotation window as small as one hour"
  const durationText = rules.Duration;
  if (durationText !== undefined && !/^\d+h$/.test(String(durationText))) return 'The Duration must be a number of hours, for example 3h.';
  const duration = durationText === undefined ? undefined : parseInt(String(durationText), 10);
  if (duration !== undefined && duration < 1) return 'The rotation window must be at least one hour.';
  let s: Schedule;
  if (expression === undefined) {
    // AutomaticallyAfterDays: "Valid Range: Minimum value of 1. Maximum value of 1000."
    const days = Number(rules.AutomaticallyAfterDays ?? 30);
    if (!Number.isInteger(days) || days < 1 || days > 1000) return 'AutomaticallyAfterDays must be between 1 and 1000.';
    s = { kind: 'days', every: days * DAY, duration };
  } else {
    const rate = /^rate\((\d+) (hour|hours|day|days)\)$/.exec(String(expression));
    const cron = /^cron\((.*)\)$/.exec(String(expression));
    if (rate) {
      const n = Number(rate[1]);
      const unit = rate[2]!.startsWith('day') ? DAY : HOUR;
      // "You can rotate a secret as often as every four hours. The maximum rotation period is 999 days."
// source: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html "You can rotate a secret as often as every four hours."
      if (n * unit < 4 * HOUR) return 'You can rotate a secret as often as every four hours.';
// source: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html "The maximum rotation period is 999 days."
      if (n * unit > 999 * DAY) return 'The maximum rotation period is 999 days.';
      s = { kind: unit === DAY ? 'days' : 'hours', every: n * unit, duration };
    } else if (cron) {
      const parsed = cronOf(cron[1]!);
      if (typeof parsed === 'string') return parsed;
      s = { kind: 'cron', cron: parsed, duration };
    } else return `Invalid ScheduleExpression: ${String(expression)}. Use a rate() or cron() expression.`;
  }
  return windowRefused(s);
}

/** A schedule whose windows come too often, or overrun: "You can rotate a secret as often as every four hours", and
 *  "the rotation window must not extend into the next rotation window. In other words, for a rotation schedule in
 *  hours, confirm that the rotation window is less than or equal to the number of hours between rotations. For a
 *  rotation schedule in days, confirm that the start hour plus the window duration is less than or equal to 24 hours"
 *  (rotate-secrets_schedule.html); the window "must not extend into the next rotation window or the next UTC day"
 *  (RotationRulesType, Duration). */
function windowRefused(s: Schedule): Schedule | string {
  const hours = s.kind === 'cron' ? s.cron.hours : s.kind === 'hours' ? grid(s.every) : [0];
  let gap = s.kind === 'cron' ? Infinity : s.every;
  if (s.kind === 'cron') {
    let last: number | undefined;
    for (let day = floorDay(Date.UTC(2024, 0, 1) / 1000), n = 0; n < HORIZON_DAYS; day += DAY, n++) {
      if (!cronDay(s.cron, day)) continue;
      for (const h of hours) {
        if (last !== undefined) gap = Math.min(gap, day + h * HOUR - last);
        last = day + h * HOUR;
      }
    }
    if (last === undefined) return 'The cron expression matches no day.';
// source: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html "You can rotate a secret as often as every four hours."
    if (gap < 4 * HOUR) return 'You can rotate a secret as often as every four hours.';
  }
// source: spec:/shapes/com.amazonaws.secretsmanager#RotationRulesType/members/Duration "The window must not extend into the next rotation window or the next UTC day."
  if (s.duration !== undefined && (s.duration * HOUR > gap || hours.some((h) => h + s.duration! > 24))) return 'The rotation window must not extend into the next rotation window or the next UTC day.';
  return s;
}

/** The World's next number in a sequence (an id's number, a nonce): issued from the tree over the declared
 *  `_seq_<what>` (ctx.issue), never a row count. */
export const next = async (ctx: Pick<HandlerContext, 'issue'>, what: string): Promise<number> => Number(await ctx.issue(`_seq_${what}`));
