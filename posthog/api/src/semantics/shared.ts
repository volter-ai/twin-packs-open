// What every family of PostHog's API shares: the project a path names and whether the request's personal API key may
// read or change it, and the API's answers (`{type, code, detail, attr}`).
import type { HandlerContext } from '@volter/world-core';
import { bearerKey, covers, distinctIdsOf, EVENT, EVENT_DELETION, obj, PERSON, personName, projectById, pyIso, type Row } from '../../../src/semantics/shared.ts';

export * from '../../../src/semantics/shared.ts';

export const apiError = (status: number, type: string, code: string, detail: string): Response =>
  Response.json({ type, code, detail, attr: null }, { status });

/** The project a path names, if the request's personal key is its organization's and covers `scope`; else the API's
 *  refusal. */
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/permissions.py "API key missing required scope"
export function projectFor(ctx: HandlerContext, scope: string): Row | Response {
  const key = bearerKey(ctx);
  if (!key) return apiError(401, 'authentication_error', 'authentication_failed', 'Personal API key found in request Authorization header is invalid.');
  const project = projectById(ctx, String(ctx.call.params.project_id ?? ''));
  // Where the documentation stops: a project the key's organization does not hold is answered as one that does not exist
  if (!project || project.id !== key.project) return apiError(404, 'invalid_request', 'not_found', 'Not found.');
  if (!covers(key, scope)) return apiError(403, 'authentication_error', 'permission_denied', `API key missing required scope '${scope}'`);
  return project;
}

export const query = (ctx: HandlerContext): URLSearchParams => new URL(ctx.call.request.url).searchParams;

/** The URL of this request with some parameters replaced: a list's `next` and `previous`. */
export function withParams(ctx: HandlerContext, params: Record<string, string>): string {
  const url = new URL(ctx.call.request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/** An event as the events API answers it (posthog/models/event/util.py, ClickhouseEventSerializer): its person only
 *  when asked for (`include_person`), the person's first distinct id and its email, name and username. */
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/models/event/util.py "only send the first one to avoid a payload bloat"
export function eventView(ctx: HandlerContext, e: Row, people: boolean): Row {
  let person: Row | null = null;
  if (people) {
    const held = ctx.row(PERSON, String(e._person ?? ''));
    if (held && held.deleted !== true) {
      const p = obj(held.properties);
      person = { is_identified: held.is_identified === true, distinct_ids: distinctIdsOf(ctx, held).slice(0, 1), properties: Object.fromEntries(['email', 'name', 'username'].filter((k) => k in p).map((k) => [k, p[k]])) };
    }
  }
  return { id: e.id, distinct_id: e.distinct_id, properties: e.properties, event: e.event, timestamp: pyIso(e.timestamp), person, elements: e.elements ?? [], elements_chain: e.elements_chain ?? '' };
}

/** A person as the persons list answers it (the actors serializer), and as its retrieve does. */
export function personListView(ctx: HandlerContext, p: Row): Row {
  const ids = distinctIdsOf(ctx, p);
  return { type: 'person', id: p.uuid, uuid: p.uuid, distinct_ids: ids, properties: p.properties, is_identified: p.is_identified === true, created_at: pyIso(p.created_at), last_seen_at: p._last_seen_at ? pyIso(p._last_seen_at) : null, name: personName(p, ids), matched_recordings: [], value_at_data_point: null };
}
export function personView(ctx: HandlerContext, p: Row): Row {
  const ids = distinctIdsOf(ctx, p);
  return { id: p._pk, name: personName(p, ids), distinct_ids: ids, properties: p.properties, created_at: pyIso(p.created_at), uuid: p.uuid, last_seen_at: p._last_seen_at ? pyIso(p._last_seen_at) : null };
}

/** A person by the id a path names: its UUID or its numeric id. */
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/api/person.py "Accepts both numeric ID and UUID."
export const personByRef = (ctx: HandlerContext, project: Row, ref: string): Row | undefined =>
  ctx.rowsRaw(PERSON).find((p) => p.deleted !== true && p._project === String(project.id) && (p.uuid === ref || String(p._pk) === ref));

/** The events deletions queued for a person: run once due, at 5AM UTC on the Sunday after they were queued, deleting the
 *  events captured before the request. The clock's mover runs them (`POST /twin/due`, semantics/clock.ts), each written at
 *  the moment it fell due. */
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/api/person.py "The task does not run immediately and instead is batched together and at 5AM UTC every Sunday"
export function deletionDue(queued: string): string {
  const d = new Date(queued);
  const at = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 5, 0, 0));
  const ahead = (7 - at.getUTCDay()) % 7;
  at.setUTCDate(at.getUTCDate() + ahead);
  if (at.getTime() <= d.getTime()) at.setUTCDate(at.getUTCDate() + 7);
  return at.toISOString();
}
export async function deleteDueEvents(ctx: HandlerContext, project: Row): Promise<void> {
  const now = ctx.occurredAt;
  for (const job of ctx.rowsRaw(EVENT_DELETION).filter((j) => j.deleted !== true && j.project === project.id && j.done !== true && String(j.due) <= now)) {
    const later = await ctx.at(String(job.due));
    await later.asVendor(async () => {
      const ids = (job.distinct_ids as string[]) ?? [];
      for (const e of later.rowsRaw(EVENT).filter((e) => e.deleted !== true && e._project === String(project.id) && (e._person === job.person || ids.includes(String(e.distinct_id))) && String(e._received) <= String(job.queued_at)))
        await later.remove(EVENT, String(e.id), 'event.delete');
      await later.record(EVENT_DELETION, { project: job.project, person: job.person, distinct_ids: ids, queued_at: job.queued_at, due: job.due, done: true }, String(job.id), 'async_deletion.done');
    });
  }
}
