// The World's doors (architecture, "Doors, screens and the gap"): what Linear's app does that its API does not — an
// OAuth application made in settings, a workspace made with its first person, a person joining, and a person's API key.
// Teams and projects are not doors: they are made through the API (teamCreate, projectCreate).
import type { HandlerContext } from '@volter/world-core';
import { ACCESS, APP, appUserFields, hexToken, obj, ORG, organizationFields, sha256, TEAM, USER, userFields } from './shared.ts';

const bad = (message: string, status = 400): Response => Response.json({ message }, { status });
const orgOf = (ctx: HandlerContext, urlKey: unknown): Record<string, unknown> | undefined => ctx.rowsRaw(ORG).find((o) => o.deleted !== true && o.urlKey === urlKey);

async function person(ctx: HandlerContext, org: string, b: Record<string, unknown>, admin: boolean, owner = false): Promise<Response | string> {
  const refusal = personInput(ctx, b); if (refusal) return refusal;
  const handle = String(b.email).split('@')[0]!;
  const user = await ctx.create(USER, (id) => ({
    ...userFields(ctx, id, { org, name: String(b.name), displayName: handle, email: String(b.email), admin, owner }),
    _password: sha256(ctx, `${id}:${b.password}`),
  }), 'user.create');
  return String(user.id);
}

/** An existing application asked for again by its name: its callback URLs edited in Linear's settings when the door
 *  is given new `redirect_uris`; the application as it now stands. */
async function redirectUrisEdited(ctx: HandlerContext, app: Record<string, unknown>, uris: string[]): Promise<Record<string, unknown>> {
  if (!uris.length) return app;
  await ctx.record(APP, { ...app, redirect_uris: uris }, String(app.id));
  return ctx.row(APP, String(app.id))!;
}

/** An OAuth application, made in Linear's settings once by its name; its credentials answered again after. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const name = typeof b.name === 'string' && b.name ? b.name : 'World App';
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
  if (uris.some((u) => !/^https?:\/\//.test(u))) return bad('redirect_uris must be http(s) URLs');
  const secretOf = async (app: Record<string, unknown>): Promise<string> => (await hexToken(ctx, String(app._secret_label ?? `linear-client-secret:${app.id}`))).slice(0, 32);
  let app = ctx.rowsRaw(APP).find((a) => a.deleted !== true && a.name === name);
  if (app) app = await redirectUrisEdited(ctx, app, uris);
  else {
    const id = await ctx.issue(APP);
    const clientId = (await hexToken(ctx, `linear-client-id:${id}`)).slice(0, 32);
    await ctx.record(APP, { name, client_id: clientId, redirect_uris: uris, secret_sha256: sha256(ctx, await secretOf({ id })) }, id);
    app = ctx.row(APP, id)!;
  }
  if (b.client_credentials) {
    const setting = obj(b.client_credentials);
    const org = orgOf(ctx, setting.workspace);
    const teams = Array.isArray(setting.teamIds) ? setting.teamIds.map(String) : [];
    if (!org || !teams.length || teams.some((id) => ctx.row(TEAM, id)?._org !== org.id)) return bad('Client credentials need a workspace and its allowed teams');
    let actor = ctx.rowsRaw(USER).find((u) => u.app === true && u._app === app!.id && u._org === org.id);
    if (!actor) actor = await ctx.create(USER, (id) => appUserFields(ctx, id, String(org.id), app!), 'user.create');
    // source: https://linear.app/developers/oauth-2-0-authentication "Client credentials"
    await ctx.record(APP, { ...app, client_credentials: true, org: org.id, actor_user: actor.id, teamIds: teams }, String(app.id));
  }
  // the secret, drawn again from its label; the row keeps only its SHA-256
  return Response.json({ client_id: app.client_id, client_secret: await secretOf(app) }, { status: 201 });
}

/** A workspace made in Linear's app, its first person its admin. */
export async function workspaces(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  if (typeof b.name !== 'string' || !b.name) return bad('a workspace needs a name');
  if (typeof b.urlKey !== 'string' || !/^[a-z0-9-]{3,32}$/.test(b.urlKey)) return bad('a urlKey is 3-32 lowercase letters, digits and dashes');
  if (orgOf(ctx, b.urlKey)) return bad('that workspace URL is taken', 409);
  const invalidOwner = personInput(ctx, obj(b.owner)); if (invalidOwner) return invalidOwner;
  const org = await ctx.create(ORG, (id) => organizationFields(ctx, id, { name: b.name as string, urlKey: b.urlKey as string }), 'organization.create');
  const id = String(org.id);
  const owner = await person(ctx, id, obj(b.owner), true, true);
  if (owner instanceof Response) return owner;
  return Response.json({ id, urlKey: b.urlKey, owner }, { status: 201 });
}

/** A person joins a workspace. */
export async function people(ctx: HandlerContext): Promise<Response> {
  const org = orgOf(ctx, ctx.call.params.urlKey);
  if (!org) return bad('no such workspace', 404);
  const id = await person(ctx, String(org.id), obj(ctx.body), false);
  return id instanceof Response ? id : Response.json({ id }, { status: 201 });
}

/** A person's personal API key (`lin_api_` and 40 letters and digits), shown once in Linear's settings. */
export async function apiKeys(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const u = ctx.rowsRaw(USER).find((x) => x.deleted !== true && x.email === b.email && x.app !== true);
  if (!u) return bad('no person has that email', 404);
  const id = await ctx.issue(ACCESS);
  const key = `lin_api_${ctx.crypto.base62From(await ctx.secret(`linear-api-key:${id}`), 40)}`;
  await ctx.record(ACCESS, { org: u._org, user: u.id, scope: 'read write', label: b.label ?? 'API key', sha256: sha256(ctx, key) }, id);
  return Response.json({ key }, { status: 201 });
}

/** The organization's workspace with a deployment OAuth application and independent personal API key. */
export async function localCredentials(ctx: HandlerContext): Promise<Response> {
  try {
    const b = obj(ctx.body);
    const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
    if (uris.some((uri) => !/^https?:\/\//.test(uri))) return bad('redirect_uris must be http(s) URLs');
    const organization = await ctx.organization();
    const org = await ctx.tenant(ORG, async (organization) => {
      const rule = { max: 32, lower: true, allowed: /[a-z0-9-]/ };
      const label = organization.id.length < 3 ? `workspace-${organization.id}` : organization.id;
      const create = (suffixed: boolean) => ctx.createUnique(ORG, (id) => organizationFields(ctx, id, { name: organization.label, urlKey: ctx.vendorName(label, rule, { suffixed, identity: organization.id }) }), 'organization.create');
      let made = await create(false);
      if (!made.created) made = await create(true);
      if (!made.created) throw bad(`that workspace URL is taken (${organization.id})`, 409);
      return String(made.row.id);
    });
    const email = organization.members[0]!.toLowerCase();
    let owner = ctx.rowsRaw(USER).find((row) => row._org === org.id && row.email === email && row.app !== true);
    if (!owner) {
      const made = await ctx.createUnique(USER, (id) => userFields(ctx, id, { org: String(org.id), name: organization.label, displayName: email.split('@')[0]!, email, admin: true, owner: true }), 'user.create');
      owner = ctx.row(USER, String(made.row.id))!;
    }
    if (owner.active === false || owner.archivedAt) return bad('Authentication required, not authenticated', 401);
    const app = await ctx.deploymentObject(`oauth-app:${org.id}`, APP, async (deployment) => {
      const id = await ctx.issue(APP);
      const clientId = (await hexToken(ctx, `linear-client-id:${id}`)).slice(0, 32);
      await ctx.record(APP, { name: deployment || 'World App', client_id: clientId, redirect_uris: uris, org: org.id, _owner: owner!.id }, id);
      return id;
    });
    const clientSecret = await ctx.accountKey('client-secret', APP, {
      make: async () => {
        const before = ctx.row(APP, String(app.id))!;
        const serial = await ctx.issue('_credential_serial');
        await ctx.change(APP, String(app.id), (row) => row.org === org.id && row._owner === owner!.id && row._secret_pending !== true && row._secret_label === before._secret_label && row.secret_sha256 === before.secret_sha256
          ? { _secret_label: `linear-client-secret:${serial}`, _secret_pending: true } : undefined, 'application.secret.reserve', { input: 'omit' });
        const selected = ctx.row(APP, String(app.id))!;
        const value = (await hexToken(ctx, String(selected._secret_label))).slice(0, 32);
        await ctx.change(APP, String(app.id), (row) => row.org === org.id && row._owner === owner!.id && row._secret_label === selected._secret_label
          ? { secret_sha256: sha256(ctx, value), _secret_pending: false } : undefined, 'application.secret.issue', { input: 'omit' });
        return String(app.id);
      },
      read: async (row) => {
        if (row.id !== app.id || row.org !== org.id || row._owner !== owner!.id || row._secret_pending === true || typeof row._secret_label !== 'string') return undefined;
        const value = (await hexToken(ctx, row._secret_label)).slice(0, 32);
        return sha256(ctx, value) === row.secret_sha256 ? value : undefined;
      },
    });
    const key = await ctx.accountKey('api-key', ACCESS, {
      make: async () => {
        const id = await ctx.issue(ACCESS);
        const value = `lin_api_${ctx.crypto.base62From(await ctx.secret(`linear-api-key:${id}`), 40)}`;
        await ctx.record(ACCESS, { org: org.id, user: owner!.id, scope: 'read write', label: ctx.deployment() || 'world', sha256: sha256(ctx, value) }, id);
        return id;
      },
      read: async (row) => {
        if (row.org !== org.id || row.user !== owner!.id || row.revoked === true || (row.expires !== undefined && Date.parse(String(row.expires)) <= Date.parse(ctx.occurredAt))) return undefined;
        const value = `lin_api_${ctx.crypto.base62From(await ctx.secret(`linear-api-key:${row.id}`), 40)}`;
        return sha256(ctx, value) === row.sha256 ? value : undefined;
      },
    });
    return Response.json({ client_id: app.client_id, client_secret: clientSecret.secret, api_key: key.secret }, { status: 201 });
  } catch (error) { if (error instanceof Response) return error; throw error; }
}

/** Validate a whole workspace owner before its organization is written. */
function personInput(ctx: HandlerContext, b: Record<string, unknown>): Response | undefined {
  if (typeof b.name !== 'string' || !b.name || typeof b.email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(b.email)) return bad('a person needs a name and an email');
  if (typeof b.password !== 'string' || b.password.length < 8) return bad('a password needs 8 characters');
  if (ctx.rowsRaw(USER).some((u) => u.deleted !== true && u.email === b.email)) return bad('that email already has an account', 409);
  return undefined;
}
