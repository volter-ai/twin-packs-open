// The events capture stored, as PostHog's events API lists and reads them (posthog/api/event.py): newest first between
// `after` (a day back by default) and `before`, by event name, distinct id, person or event properties, a page of
// `limit` with the next page asked for by the last event's timestamp.
import type { HandlerContext } from '@volter/world-core';
import { apiError, EVENT, eventView, obj, personByRef, personOf, projectFor, query, type Row, withParams } from './shared.ts';
import { uuidLike } from '../../../src/semantics/shared.ts';

const includePerson = (q: URLSearchParams): boolean => ['true', '1'].includes((q.get('include_person') ?? '').toLowerCase());

/** Whether an event's properties hold every one of a `properties` filter (PostHog's property filter JSON: a list of
 *  `{key, value, operator}`, `exact` by default). */
function holds(props: Row, filters: unknown): boolean {
  const list = Array.isArray(filters) ? filters : Array.isArray(obj(filters).values) ? obj(filters).values as unknown[] : [];
  return list.every((f0) => {
    const f = obj(f0);
    const v = props[String(f.key)];
    const want = f.value;
    switch (String(f.operator ?? 'exact')) {
      case 'is_set': return v !== undefined && v !== null;
      case 'is_not_set': return v === undefined || v === null;
      case 'is_not': return Array.isArray(want) ? !want.map(String).includes(String(v)) : String(v) !== String(want);
      case 'icontains': return v !== undefined && String(v).toLowerCase().includes(String(want).toLowerCase());
      case 'not_icontains': return v === undefined || !String(v).toLowerCase().includes(String(want).toLowerCase());
      default: return v !== undefined && (Array.isArray(want) ? want.map(String).includes(String(v)) : String(v) === String(want));
    }
  });
}

// source: spec:events_list "This endpoint allows you to list and filter events."
export async function events_list(ctx: HandlerContext): Promise<Response> {
  const project = projectFor(ctx, 'query:read');
  if (project instanceof Response) return project;
  const q = query(ctx);
  const now = Date.parse(ctx.occurredAt);
  // source: spec:events_list "Only return events with a timestamp after this time. Default: now() - 24 hours."
  const after = q.get('after') ? Date.parse(q.get('after')!) : now - 86400000;
  // source: spec:events_list "Only return events with a timestamp before this time. Default: now() + 5 seconds."
  const before = q.get('before') ? Date.parse(q.get('before')!) : now + 5000;
  if (!Number.isFinite(after) || !Number.isFinite(before)) return apiError(400, 'validation_error', 'invalid_input', 'Invalid date');
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/api/event.py "EVENT_LIST_MAX_LIMIT = 1_000"
  const limit = Math.min(1000, Math.max(1, Number(q.get('limit') || 100) || 100));
  const offset = Math.max(0, Number(q.get('offset') || 0) || 0);
  let filters: unknown = [];
  try { filters = q.get('properties') ? JSON.parse(q.get('properties')!) : []; } catch { return apiError(400, 'validation_error', 'invalid_input', 'Properties are unparsable!'); }
  const person = q.get('person_id') ? personByRef(ctx, project, q.get('person_id')!) : undefined;
  if (q.get('person_id') && !person) return Response.json({ next: null, results: [] });
  const order = q.get('orderBy') ? (() => { try { return JSON.parse(q.get('orderBy')!) as unknown[]; } catch { return ['-timestamp']; } })() : ['-timestamp'];
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/api/event.py "if len(order_by) == 1 and order_by[0]"
  const desc = order.length === 1 && order[0] === '-timestamp';
  const rows = ctx.rowsRaw(EVENT).filter((e) => {
    if (e.deleted === true || String(e._project) !== String(project.id)) return false;
    const t = Date.parse(String(e.timestamp));
    if (t <= after || t >= before) return false;
    if (q.get('event') && e.event !== q.get('event')) return false;
    if (q.get('distinct_id') && e.distinct_id !== q.get('distinct_id')) return false;
    if (person && personOf(ctx, project, String(e.distinct_id))?.id !== person.id && e._person !== person.id) return false;
    return holds(obj(e.properties), filters);
  }).sort((a, b) => (desc ? -1 : 1) * (Date.parse(String(a.timestamp)) - Date.parse(String(b.timestamp))));
  const page = rows.slice(offset, offset + limit);
  const people = includePerson(q);
  // the next page names the last event's timestamp as its bound (event.py, _build_next_url)
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/api/event.py "timestamp = last_event_timestamp.replace(tzinfo=UTC).isoformat()"
  const more = rows.length > offset + limit;
  const last = page.at(-1);
  const next = more && last ? withParams(ctx, { [desc ? 'before' : 'after']: new Date(String(last.timestamp)).toISOString().replace('Z', '+00:00') }) : null;
  return Response.json({ next, results: page.map((e) => eventView(ctx, e, people)) });
}

// source: spec:events_retrieve "Include person details for the event. Default: false."
export async function events_retrieve(ctx: HandlerContext): Promise<Response> {
  const project = projectFor(ctx, 'query:read');
  if (project instanceof Response) return project;
  const id = String(ctx.call.params.id ?? '');
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/api/event.py "Invalid UUID"
  if (!uuidLike(id)) return Response.json({ detail: 'Invalid UUID', code: 'invalid', type: 'validation_error' }, { status: 400 });
  const e = ctx.rowsRaw(EVENT).find((x) => x.deleted !== true && x._project === String(project.id) && String(x.id).replace(/-/g, '').toLowerCase() === id.replace(/-/g, '').toLowerCase());
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/api/event.py "No events exist for event UUID"
  if (!e) return apiError(404, 'invalid_request', 'not_found', `No events exist for event UUID ${id}`);
  return Response.json(eventView(ctx, e, includePerson(query(ctx))));
}
