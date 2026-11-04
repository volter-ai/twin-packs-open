// What Firebase answers for what the Hacker News API does not hold (architecture, "Pack layout": gap.ts). The API is a
// Firebase Realtime Database read over REST: every location is a path, and one that holds nothing is null.
import type { HandlerContext } from '@volter/world-core';
import { answer } from './shared.ts';

export function gap(ctx: HandlerContext): Response {
  // source: https://firebase.google.com/docs/reference/rest/database "The request violates your Firebase Realtime Database Security Rules."
  // Hacker News's data is public to read and written by no one through the API: a write is refused as the database's
  // rules refuse it. Where the documentation stops: the body's words are not documented; the twin says Permission denied,
  // as Firebase's streaming cancel event names the same cause.
  if (ctx.call.request.method !== 'GET' && ctx.call.request.method !== 'HEAD') return ctx.raw(JSON.stringify({ error: 'Permission denied' }), { status: 401, headers: { 'content-type': 'application/json; charset=utf-8' } });
  // source: https://firebase.google.com/docs/reference/rest/database "You can use any Firebase Realtime Database URL as a REST endpoint."
  // Where the documentation stops: a location that holds nothing reads as JSON null, the data at that path.
  return answer(ctx, null);
}
