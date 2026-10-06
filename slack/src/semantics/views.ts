// Slack's views.* methods an app's Home tab takes (https://docs.slack.dev/surfaces/app-home): the view an app
// publishes for one person: one `home_view` subject per app and person, its id the view's (`V0…`, minted).
import type { HandlerContext } from '@volter/world-core';
import { arg, fail, jsonArg, now, ok, who } from './shared.ts';

/** A refusal that says which argument was wrong (`response_metadata.messages`), as Slack's invalid_arguments does. */
async function withMessages(refusal: Response, messages: string[]): Promise<Response> {
  const body = await refusal.json() as Record<string, unknown>;
  return Response.json({ ...body, response_metadata: { messages } }, { status: refusal.status });
}

/** A block's text objects as Slack keeps them: a mrkdwn text is `verbatim: false` unless sent otherwise. */
// source: spec:/paths/~1views.publish/get/responses/200/examples/application~1json/view/blocks/0/text "verbatim"
function kept(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(kept);
  if (!v || typeof v !== 'object') return v;
  const o = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, kept(x)]));
  return o.type === 'mrkdwn' && typeof o.text === 'string' && o.verbatim === undefined ? { ...o, verbatim: false } : o;
}

/** views.publish: "Publish a static view for a User" on the app's Home tab: a `home` view with blocks; a `hash` naming
 *  a view that is no longer the current one is `hash_conflict`. Answers the view with its id and new hash. */
export async function views_publish(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const user = arg(ctx, 'user_id');
  // source: https://docs.slack.dev/reference/methods/views.publish "invalid_arguments"
  if (!user || !ctx.get('user', user)) return withMessages(fail(ctx, 'invalid_arguments'), ['invalid `user_id`']);
  const view = jsonArg(ctx, 'view') as Record<string, unknown> | undefined;
  if (!view || typeof view !== 'object' || view.type !== 'home' || !Array.isArray(view.blocks)) return fail(ctx, 'invalid_arguments');
  const held = ctx.rowsRaw('home_view').find((v) => v.app_id === by.app && v.user === user);
  const hash = arg(ctx, 'hash');
  if (hash && held && held.hash !== hash) return fail(ctx, 'hash_conflict');
  const id = held ? String(held.id) : ctx.mint('home_view');
  const next = `${now(ctx)}.${ctx.crypto.digest('sha256', `view:${id}:${ctx.occurredAt}`, 'hex').slice(0, 8)}`;
  const stored = {
    team_id: by.team, type: 'home', blocks: kept(view.blocks), private_metadata: view.private_metadata ?? '', callback_id: view.callback_id ?? '',
    external_id: view.external_id ?? '', hash: next, app_id: by.app, bot_id: by.bot, user, deleted: false,
  };
  await ctx.write('home_view', id, stored, 'home_view.publish');
  const { user: _u, deleted: _d, ...shown } = stored;
  return ok(ctx, { view: { id, ...shown, state: { values: {} }, root_view_id: id, previous_view_id: null, title: view.title ?? null, close: null, submit: null, clear_on_close: false, notify_on_close: false } });
}
