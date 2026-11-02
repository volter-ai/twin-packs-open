// The identity service's device page: where a person enters (or follows a link carrying) the code a command-line tool
// shows, and approves it as one of the World's people.
import type { HandlerContext } from '@volter/world-core';
import { esc, nowSeconds, page, sessionUser, sessionOf } from '../semantics/shared.ts';

/** `/device`: a device code entered (or carried in the link) and approved as one of the World's people. */
// source: recording:ui-source.txt "if (!session.data) { location.href = `/login?return_to=${encodeURIComponent(location.pathname + location.search)}`; return; }"
export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  if (request.method === 'POST') {
    const form = new URLSearchParams(ctx.text);
    const user = sessionUser(ctx);
    const code = (form.get('user_code') ?? '').replace(/-/g, '').toUpperCase();
    const d = ctx.rowsRaw('_device_code').find((r) => r.deleted !== true && r.user_code_key === code && r.status === 'pending' && Number(r.expires) > nowSeconds(ctx));
    if (!user) return new Response(null, { status: 303, headers: { location: `/login?return_to=${encodeURIComponent(`/device?user_code=${code}`)}` } });
    if (!d || (d.user !== null && d.user !== user.id)) return page('Device', '<p>That code is not pending for you.</p>');
    const refusal = ctx.legal('_device_code', 'status', 'device.approve', d.status, 'approved', String(d.id), 'external');
    if (refusal) return ctx.refuse(refusal);
    await ctx.write('_device_code', String(d.id), { status: 'approved', user: user.id, auth_time: Math.floor(Date.parse(String(sessionOf(ctx)?.created)) / 1000) }, 'device.approve');
    return page('Device', '<h1>Device approved</h1><p>You can return to your terminal.</p>');
  }
  if (!sessionUser(ctx)) return new Response(null, { status: 303, headers: { location: `/login?return_to=${encodeURIComponent(url.pathname + url.search)}` } });
  const code = url.searchParams.get('user_code') ?? '';
  return page('Device', `<h1>Approve a device</h1><form method="post" action="/device"><label>Code<input name="user_code" value="${esc(code)}" required></label><button type="submit">Continue</button></form>`);
}
