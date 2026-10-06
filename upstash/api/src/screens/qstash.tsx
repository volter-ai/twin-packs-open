// UPSTASH'S QSTASH PAGE — console.upstash.com/qstash: on a first visit its owner picks a region; then its Quickstart
// shows `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`, "Reset token" replaces
// the token (https://upstash.com/docs/qstash/howto/reset-token), and rolling the keys makes the next key current and a
// new next key (https://upstash.com/docs/qstash/howto/roll-signing-keys). Where the documentation stops: the regions
// offered are the two the multi-region page names first. A workspace (docs/contributing/architecture.md, "Screens").
import type { HandlerContext } from '@volter/world-core';
import { flowPage, formOf, Portal, PORTAL_CSS, signedIn } from '@volter/world-ui';
import { openQStash, QSTASH_USER, resetQStashToken, rollSigningKeys } from '../semantics/shared.ts';
import { COOKIE, notAllowed, type Row, SKIN, toLogin } from './shared.tsx';

const REGIONS = ['eu-central-1', 'us-east-1'];

function page(person: Row, q: Row | undefined, notice?: string, status = 200): Response {
  return flowPage({
    title: 'QStash | Upstash Console', css: [PORTAL_CSS, SKIN], status,
    body: (
      <Portal
        merchant={`${String(person.email)} · QStash`}
        {...(notice ? { notice } : {})}
        sections={q ? [{
          heading: 'Quickstart',
          empty: '',
          items: [
            { title: 'QSTASH_URL', detail: String(q._url) },
            { title: 'QSTASH_TOKEN', detail: String(q.token) },
            { title: 'QSTASH_CURRENT_SIGNING_KEY', detail: String(q._current_signing_key) },
            { title: 'QSTASH_NEXT_SIGNING_KEY', detail: String(q._next_signing_key) },
          ],
        }] : []}
        forms={q
          ? [{ heading: 'Reset token', action: '/qstash?do=reset', fields: [], submit: { label: 'Reset token' } }, { heading: 'Signing Keys', action: '/qstash?do=roll', fields: [], submit: { label: 'Roll keys' } }]
          : [{ heading: 'Select a region', action: '/qstash?do=open', fields: [{ id: 'region', label: 'Region', options: REGIONS.map((r) => ({ value: r, label: r })) }], submit: { label: 'Select' } }]}
      />
    ),
  });
}

/** Only a peer posting an action no form offers reaches this refusal. */
function unknownAction(person: Row, q: Row): Response {
  return page(person, q, 'Choose an action.', 422);
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const person = signedIn(ctx, COOKIE);
  if (!person) return toLogin('/qstash');
  const mine = (): Row | undefined => ctx.rowsRaw(QSTASH_USER).find((x) => x.customer_id === person.email && x.deleted !== true);
  if (request.method === 'GET') return page(person, mine());
  if (request.method !== 'POST') return notAllowed();
  const act = new URL(request.url).searchParams.get('do');
  const q = mine();
  if (act === 'open') {
    if (q) return page(person, q);
    const region = formOf(ctx).region ?? '';
    if (!REGIONS.includes(region)) return page(person, undefined, 'Choose a region.', 422);
    return page(person, await openQStash(ctx, { owner: String(person.email), region }));
  }
  if (!q) return page(person, undefined, 'Select a region first.', 422);
  if (act === 'reset') { await resetQStashToken(ctx, q); return page(person, mine(), 'Your token was reset. Update QSTASH_TOKEN wherever you use it.'); }
  if (act === 'roll') { await rollSigningKeys(ctx, q); return page(person, mine(), 'Signing keys rolled: the next key is now current.'); } else return unknownAction(person, q);
}
