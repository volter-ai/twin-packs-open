// GitHub's Apps operations (https://docs.github.com/en/rest/apps): an App made from a manifest, its installation on a
// repository found with its JWT, and the tokens an installation is given.
import type { HandlerContext } from '@volter/world-core';
import { PERMISSION_LEVELS } from '../engine/access.ts';
import { permissionsOf } from '../engine/objects.ts';
import { bodyOf, fail, issueToken, json, notFound, nowSeconds, repoOfPath, type Row, shown, who } from './shared.ts';

/** The App a request's JWT names, or GitHub's refusal of any other credential (where the documentation stops, "A JSON
 *  web token could not be decoded" are GitHub's words). */
// source: https://docs.github.com/en/rest/apps/apps "You must use a JWT to access this endpoint."
function appCalling(ctx: HandlerContext): Row | Response {
  const c = who(ctx);
  if (c?.kind !== 'app') return fail(ctx, 401, 'A JSON web token could not be decoded');
  return c.app;
}

/** apps/create-from-manifest: the code GitHub's manifest page gave back, exchanged once within an hour for the App it
 *  made: its id, slug, client id and secret, webhook secret and private key (201). */
// source: https://docs.github.com/en/rest/apps/apps "When you create a GitHub App with the manifest flow, you receive a temporary code used to retrieve the GitHub App's id , pem (private key), and webhook_secret ."
// source: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest "You must complete all three steps in the GitHub App Manifest flow within one hour."
export async function apps_create_from_manifest(ctx: HandlerContext): Promise<Response> {
  const code = String(ctx.call.params.code ?? '');
  const app = ctx.rowsRaw('app').find((a) => a._code === code);
  if (!app || app._code_used === true || nowSeconds(ctx) - Number(app._code_at ?? 0) > 3600) return fail(ctx, 404, 'Not Found');
  const next = await ctx.write('app', String(app.id), { _code_used: true }, 'app.manifest_converted');
  return json({ ...shown(ctx, next), client_secret: app._client_secret, webhook_secret: app._webhook_secret ?? null, pem: (await ctx.signingKey(`github-app:${String(app.id)}`)).privatePem }, 201);
}

/** An installation as answered: its stored shape. */
const installationAnswer = (ctx: HandlerContext, i: Row): Row => shown(ctx, i);

/** The repositories an installation covers: every repository of its account when it holds all, else those selected. */
function coveredBy(ctx: HandlerContext, i: Row): Row[] {
  const owner = String((i.account as Row).login);
  if (i.repository_selection === 'all') return ctx.rowsRaw('repository').filter((r) => String((r.owner as Row).login) === owner);
  const ids = (i._repository_ids as string[] | undefined) ?? [];
  return ctx.rowsRaw('repository').filter((r) => ids.includes(String(r.id)));
}

/** apps/get-repo-installation: the calling App's installation that covers the repository; an App not installed
 *  there, 404. */
// source: https://docs.github.com/en/rest/apps/apps "Enables an authenticated GitHub App to find the repository's installation information."
export async function apps_get_repo_installation(ctx: HandlerContext): Promise<Response> {
  const app = appCalling(ctx);
  if (app instanceof Response) return app;
  const repo = repoOfPath(ctx);
  const i = ctx.rowsRaw('installation').find((x) => String(x.app_id) === String(app.id) && coveredBy(ctx, x).some((r) => String(r.id) === String(repo.id)));
  return i ? json(installationAnswer(ctx, i)) : notFound(ctx);
}

/** apps/create-installation-access-token: a `ghs_` token good for an hour, holding the installation's permissions or a
 *  narrower set of them, over all its repositories or those named (by name or id) (201). Where the documentation
 *  stops: the two 422s' words are GitHub's. */
// source: https://docs.github.com/en/rest/apps/apps "Installation tokens expire one hour from the time you create them."
// source: https://docs.github.com/en/rest/apps/apps "If you don't use repositories or repository_ids to grant access to specific repositories, the installation access token will have access to all repositories that the installation was granted access to."
// source: https://docs.github.com/en/rest/apps/apps "The installation access token cannot be granted permissions that the app was not granted."
export async function apps_create_installation_access_token(ctx: HandlerContext): Promise<Response> {
  const app = appCalling(ctx);
  if (app instanceof Response) return app;
  const i = ctx.row('installation', String(ctx.call.params.installation_id ?? ''));
  if (!i || String(i.app_id) !== String(app.id)) return notFound(ctx);
  const b = bodyOf(ctx);
  const granted = (i.permissions as Row | undefined) ?? {};
  const asked = (b.permissions as Row | undefined) ?? granted;
  for (const [k, v] of Object.entries(asked)) {
    const has = PERMISSION_LEVELS.indexOf(String(granted[k] ?? 'none'));
    if (has < 1 || PERMISSION_LEVELS.indexOf(String(v)) > has) return fail(ctx, 422, 'The permissions requested are not granted to this installation.');
  }
  const covered = coveredBy(ctx, i);
  const names = [...((b.repositories as string[] | undefined) ?? []).map((n) => covered.find((r) => r.name === n)), ...((b.repository_ids as number[] | undefined) ?? []).map((n) => covered.find((r) => String(r.id) === String(n)))];
  if (names.some((r) => !r)) return fail(ctx, 422, 'There is at least one repository that does not exist or is not accessible to the parent installation.');
  const chosen = names.length ? (names as Row[]) : undefined;
  const expires = nowSeconds(ctx) + 3600;
  const token = await issueToken(ctx, 'ghs_', { kind: 'installation', installation: String(i.id), permissions: asked, expires, ...(chosen ? { repositories: chosen.map((r) => String(r.id)) } : {}) });
  return json({
    token, expires_at: new Date(expires * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'), permissions: asked, repository_selection: chosen ? 'selected' : i.repository_selection,
    ...(chosen ? { repositories: chosen.map((r) => ({ ...shown(ctx, r), permissions: permissionsOf(asked.contents === 'write' || asked.contents === 'admin' ? 'write' : 'read') })) } : {}),
  }, 201);
}
