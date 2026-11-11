// The persons capture made, as PostHog's persons API lists, reads and deletes them (posthog/api/person.py): a person by
// one of its distinct ids or a search, newest first; deleted at once with its distinct ids, its events queued for the
// weekly deletion when asked.
import type { HandlerContext } from '@volter/world-core';
import { apiError, deletionDue, DISTINCT_ID, distinctIdsOf, EVENT_DELETION, obj, PERSON, personByRef, personListView, personName, personOf, personView, projectFor, query, type Row, withParams } from './shared.ts';

// source: spec:persons_list "Search persons by email, name, person ID, or distinct ID. Partial values match."
export async function persons_list(ctx: HandlerContext): Promise<Response> {
  const project = projectFor(ctx, 'person:read');
  if (project instanceof Response) return project;
  const q = query(ctx);
  const limit = Math.max(1, Number(q.get('limit') || 100) || 100);
  const offset = Math.max(0, Number(q.get('offset') || 0) || 0);
  let rows: Row[];
  const distinctId = q.get('distinct_id');
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/api/person.py "Exact match on any of the person's distinct IDs; no matching person => no results."
  if (distinctId) { const p = personOf(ctx, project, distinctId); rows = p ? [p] : []; }
  else rows = ctx.rowsRaw(PERSON).filter((p) => p.deleted !== true && p._project === String(project.id));
  const search = (q.get('search') ?? '').trim().toLowerCase();
  if (search) rows = rows.filter((p) => {
    const ids = distinctIdsOf(ctx, p);
    const props = obj(p.properties);
    return [p.uuid, ...ids, props.email, props.name, personName(p, ids)].some((v) => v !== undefined && String(v).toLowerCase().includes(search));
  });
  // source: spec:persons_list "Filter persons by email (exact match)"
  if (q.get('email')) rows = rows.filter((p) => obj(p.properties).email === q.get('email'));
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/api/person.py "created_at DESC"
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || Number(b._pk) - Number(a._pk));
  const page = rows.slice(offset, offset + limit);
  // "A full page means there may be more behind it." (person.py)
  const next = page.length >= limit ? withParams(ctx, { offset: String(offset + limit), limit: String(limit) }) : null;
  const previous = offset - limit >= 0 ? withParams(ctx, { offset: String(offset - limit), limit: String(limit) }) : null;
  return Response.json({ results: page.map((p) => personListView(ctx, p)), next, previous, ...(q.has('include_total') ? { count: rows.length } : {}) });
}

// source: spec:persons_retrieve "A unique value identifying this person. Accepts both numeric ID and UUID."
export async function persons_retrieve(ctx: HandlerContext): Promise<Response> {
  const project = projectFor(ctx, 'person:read');
  if (project instanceof Response) return project;
  const person = personByRef(ctx, project, String(ctx.call.params.id ?? ''));
  if (!person) return apiError(404, 'invalid_request', 'not_found', 'Not found.');
  return Response.json(personView(ctx, person));
}

// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/api/person.py "Use this endpoint to delete individual persons."
export async function persons_destroy(ctx: HandlerContext): Promise<Response> {
  const project = projectFor(ctx, 'person:write');
  if (project instanceof Response) return project;
  const person = personByRef(ctx, project, String(ctx.call.params.id ?? ''));
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/api/person.py "Person not found."
  if (!person) return apiError(404, 'invalid_request', 'not_found', 'Person not found.');
  const q = query(ctx);
  const ids = distinctIdsOf(ctx, person);
  // the flag's presence is what counts: `"delete_events" in request.GET` (person.py)
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/api/person.py "in request.GET,"
  if (q.has('delete_events')) {
    // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/api/person.py "a task to delete all events associated with this person will be created and queued."
    await ctx.record(EVENT_DELETION, { project: project.id, person: person.id, distinct_ids: ids, queued_at: ctx.occurredAt, due: deletionDue(ctx.occurredAt), done: false }, undefined, 'async_deletion.create');
  }
  if (!q.has('keep_person')) {
    for (const d of ids) await ctx.write(DISTINCT_ID, `${String(project.id)}:${d}`, { _project: String(project.id), distinct_id: d, person: null }, 'person_distinct_id.delete');
    await ctx.remove(PERSON, String(person.id), 'person.delete');
  }
  return new Response(null, { status: 202 });
}
