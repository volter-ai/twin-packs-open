// POLAR'S FRONT: every request's credential, by what its operation takes (the operation's `credentials`, the security
// schemes the published document names for it, as the derive keeps them). An organization's operation (`oat`, `pat`)
// needs one of the organization's access tokens (made on the settings page: a World door, kept by its SHA-256); a
// customer portal operation (`customer_session`, `member_session`) needs a live customer session's token; the
// checkout's client operations, OAuth's endpoints and the portal's email verification need none. A missing or unknown
// credential is Polar's 401. Where the documentation stops: the refusal's words, as the API answers them. One operation
// is read otherwise: the checkout's confirm names a signed-in Polar user's credential (`oidc`, `pat`), which the buyer
// on the checkout page does not have and no organization token stands for; the twin takes the checkout's client secret,
// in its path, as the confirm's credential, as the page's other client operations do.
// source: spec:/components/securitySchemes/oat "Organization Access Token"
import { sha256, type HandlerContext } from '@volter/world-core';
import { environment, SESSION } from './shared.ts';

const unauthorized = (): Response => Response.json({ error: 'Unauthorized', detail: 'Unauthorized' }, { status: 401 });

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const takes = ctx.call.operation.id === 'checkouts:client_confirm' ? [] : ctx.call.operation.credentials ?? [];
  const bearer = /^Bearer\s+(\S+)/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  if (takes.includes('oat') || takes.includes('pat')) {
    if (!bearer) return unauthorized();
    const held = ctx.rowsRaw('_access_token').some((t) => (t._environment ?? 'production') === environment(ctx) && t._sha256 === sha256(bearer) && t.deleted !== true && (t.expires_at === null || Date.parse(String(t.expires_at)) > Date.parse(ctx.occurredAt)));
    if (!held) return unauthorized();
  }
  return next();
}
