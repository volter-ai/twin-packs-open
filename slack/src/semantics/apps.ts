// Slack's apps.* methods (https://docs.slack.dev/reference/methods?family=apps): apps made and changed from their
// manifests with an app configuration token (the App Manifest APIs), and an app uninstalled.
import type { HandlerContext } from '@volter/world-core';
import { manifestErrors } from '../engine/app-manifest.ts';
import { appOfClient, arg, fail, jsonArg, makeApp, ok, serial, SOCKET_TICKETS, socketMode, uninstallApp, verifyRequestUrl, who, type Caller } from './shared.ts';

type Row = Record<string, unknown>;

/** The App Manifest APIs take only an app configuration token ("not_allowed_token_type": "The token type used in this
 *  request is not allowed", https://docs.slack.dev/reference/methods/apps.manifest.create). */
function configCaller(ctx: HandlerContext): Caller | Response {
  const by = who(ctx);
  return by.kind === 'config' ? by : fail(ctx, 'not_allowed_token_type');
}

/** The manifest argument, JSON text in a form or JSON in a JSON body. */
function manifestArg(ctx: HandlerContext): unknown {
  return jsonArg(ctx, 'manifest');
}

/** A manifest's errors as Slack answers them. */
const invalid = (errors: Array<{ message: string; pointer: string }>): Response => Response.json({ ok: false, error: 'invalid_manifest', errors });

/** apps.manifest.validate: "Validate an app manifest". */
export async function apps_manifest_validate(ctx: HandlerContext): Promise<Response> {
  const by = configCaller(ctx);
  if (by instanceof Response) return by;
  const errors = manifestErrors(manifestArg(ctx));
  return errors.length ? invalid(errors) : ok(ctx);
}

/** apps.manifest.create: "Create an app from an app manifest" in the configuration token's workspace; answers its id,
 *  its credentials and its install page. */
export async function apps_manifest_create(ctx: HandlerContext): Promise<Response> {
  const by = configCaller(ctx);
  if (by instanceof Response) return by;
  const manifest = manifestArg(ctx);
  const errors = manifestErrors(manifest);
  if (errors.length) return invalid(errors);
  const app = await makeApp(ctx, manifest as Row, { team: by.team, creator: by.user });
  const credentials = app.credentials as Row;
  return ok(ctx, { app_id: app.id, credentials, oauth_authorize_url: `https://slack.com/oauth/v2/authorize?client_id=${String(credentials.client_id)}` });
}

/** The app a manifest method names by `app_id`: one the configuration token's workspace made ("app_not_found"). */
function ownApp(ctx: HandlerContext, by: Caller): Row | Response {
  const id = arg(ctx, 'app_id');
  const app = id ? ctx.row('app', id) : undefined;
  return app && app.team_id === by.team && app.deleted !== true ? app : fail(ctx, 'app_not_found');
}

/** apps.manifest.update: "Update an app from an app manifest"; answers whether its permissions changed. */
export async function apps_manifest_update(ctx: HandlerContext): Promise<Response> {
  const by = configCaller(ctx);
  if (by instanceof Response) return by;
  const app = ownApp(ctx, by);
  if (app instanceof Response) return app;
  const manifest = manifestArg(ctx);
  const errors = manifestErrors(manifest);
  if (errors.length) return invalid(errors);
  const scopes = (m: Row): string => JSON.stringify((m.oauth_config as Row | undefined)?.scopes ?? {});
  const updated = await ctx.write('app', String(app.id), { manifest }, 'app.update');
  const urlOf = (m: Row): unknown => (((m.settings as Row | undefined)?.event_subscriptions as Row | undefined)?.request_url);
  if (urlOf(manifest as Row) !== urlOf(app.manifest as Row)) await verifyRequestUrl(ctx, { ...updated, id: app.id, credentials: app.credentials });
  return ok(ctx, { app_id: app.id, permissions_updated: scopes(app.manifest as Row) !== scopes(manifest as Row) });
}

/** apps.manifest.export: the app's manifest. */
export async function apps_manifest_export(ctx: HandlerContext): Promise<Response> {
  const by = configCaller(ctx);
  if (by instanceof Response) return by;
  const app = ownApp(ctx, by);
  if (app instanceof Response) return app;
  return ok(ctx, { manifest: app.manifest });
}

/** apps.manifest.delete: "Permanently deletes an app created through app manifests". */
export async function apps_manifest_delete(ctx: HandlerContext): Promise<Response> {
  const by = configCaller(ctx);
  if (by instanceof Response) return by;
  const app = ownApp(ctx, by);
  if (app instanceof Response) return app;
  await ctx.write('app', String(app.id), { deleted: true }, 'app.delete');
  return ok(ctx);
}

/** apps.uninstall: "Uninstalls your app from a workspace", named by its `client_id` and `client_secret` ("invalid_client_id"
 *  for a client id no app has, "bad_client_secret" for another secret): every token its install issued in the calling
 *  token's workspace is revoked. */
export async function apps_uninstall(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const app = appOfClient(ctx, arg(ctx, 'client_id'));
  if (!app) return fail(ctx, 'invalid_client_id');
  if ((app.credentials as Row).client_secret !== arg(ctx, 'client_secret')) return fail(ctx, 'bad_client_secret');
  await uninstallApp(ctx, app, by.team);
  return ok(ctx);
}

/** apps.connections.open: "Generate a temporary Socket Mode WebSocket URL that your app can connect to in order to
 *  receive events and interactive payloads", with an app-level token (`connections:write`); an app without Socket Mode
 *  in its manifest is refused. The URL is the World's own socket (the manifest's `socketMode`, spoken by
 *  ./sockets.ts) at the vendor's path, `/link/?ticket=…&app_id=…`, on the address the caller reached the twin by, as
 *  Discord's `GET /gateway/bot` answers its Gateway: the ticket is kept, and opens one connection. */
// source: https://docs.slack.dev/apis/events-api/using-socket-mode "The URL is created at runtime by calling the apps.connections.open method"
export async function apps_connections_open(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  if (by.kind !== 'app') return fail(ctx, 'not_allowed_token_type');
  const app = ctx.row('app', String(by.app));
  if (!socketMode(app)) return fail(ctx, 'socket_mode_disabled');
  const ticket = ctx.crypto.uuidFrom(await ctx.secret(`socket:${String(by.app)}:${await serial(ctx, 'socket')}`));
  await ctx.record(SOCKET_TICKETS, { app: by.app, team: by.team, issued: ctx.occurredAt }, ticket);
  const base = ctx.publicBase.replace(/^http/, 'ws').replace(/\/+$/, '');
  return ok(ctx, { url: `${base}/link/?ticket=${ticket}&app_id=${String(by.app)}` });
}
