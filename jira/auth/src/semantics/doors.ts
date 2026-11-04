// The World's doors (architecture, "Doors, screens and the gap"): Atlassian's sign-up of a Jira Cloud site (its cloudid
// and URL, its first person its admin), a person given access to it, and an OAuth 2.0 (3LO) app made in the developer
// console. Projects and components are not doors: they are made through the platform API (the seeding rule).
import type { HandlerContext } from '@volter/world-core';
import { API_TOKEN, APP, obj, PERSON, sha256, SITE, tokenValue } from '../../../src/semantics/shared.ts';

const bad = (message: string, status = 400): Response => Response.json({ message }, { status });
const siteNamed = (ctx: HandlerContext, name: unknown): Record<string, unknown> | undefined => ctx.rowsRaw(SITE).find((s) => s.deleted !== true && s.name === name);

async function person(ctx: HandlerContext, site: string, b: Record<string, unknown>, admin: boolean): Promise<Response | string> {
  if (typeof b.name !== 'string' || !b.name || typeof b.email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(b.email)) return bad('a person needs a name and an email');
  if (typeof b.password !== 'string' || b.password.length < 8) return bad('a password needs 8 characters');
  let held = ctx.rowsRaw(PERSON).find((p) => p.deleted !== true && p.email === b.email);
  if (!held) {
    // an Atlassian account id, as the API names people (accountId)
    const made = await ctx.createUnique(PERSON, (id) => ({ accountId: id, displayName: b.name, email: b.email, active: true, sites: [], admin_of: [], password_sha256: sha256(ctx, `${id}:${b.password}`) }), 'person.create');
    held = ctx.row(PERSON, String(made.row.id))!;
  }
  await ctx.change(PERSON, String(held.id), (row) => ({ sites: [...new Set([...(row.sites as string[]), site])], admin_of: admin ? [...new Set([...(row.admin_of as string[]), site])] : row.admin_of }), 'person.site');
  return String(held.id);
}

/** A Jira Cloud site signed up for: `<name>.atlassian.net`, its cloudid a UUID. */
export async function sites(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  if (typeof b.name !== 'string' || !/^[a-z0-9-]{3,63}$/.test(b.name)) return bad('a site name is 3-63 lowercase letters, digits and dashes');
  if (siteNamed(ctx, b.name)) return bad('that site name is taken', 409);
  const made = await ctx.createUnique(SITE, { name: b.name, url: `https://${b.name}.atlassian.net` }, 'site.create');
  if (!made.created) return bad('that site name is taken', 409);
  const id = String(made.row.id);
  const admin = await person(ctx, id, obj(b.admin), true);
  if (admin instanceof Response) return admin;
  return Response.json({ cloudid: id, name: b.name, url: `https://${b.name}.atlassian.net`, admin }, { status: 201 });
}

/** A person given access to a site. */
export async function people(ctx: HandlerContext): Promise<Response> {
  const site = siteNamed(ctx, ctx.call.params.name);
  if (!site) return bad('no such site', 404);
  const id = await person(ctx, String(site.id), obj(ctx.body), false);
  return id instanceof Response ? id : Response.json({ accountId: id }, { status: 201 });
}

/** An OAuth 2.0 (3LO) app, made once by its name; its credentials answered again after. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const name = typeof b.name === 'string' && b.name ? b.name : 'World App';
  const urls = Array.isArray(b.callback_urls) ? b.callback_urls.map(String) : [];
  if (urls.some((u) => !/^https?:\/\//.test(u))) return bad('callback_urls must be http(s) URLs');
  const secretOf = async (id: string): Promise<string> => (await tokenValue(ctx, `jira-client-secret:${id}`)).slice(0, 64);
  let app = ctx.rowsRaw(APP).find((a) => a.deleted !== true && a.name === name);
  if (!app) {
    const id = await ctx.issue(APP);
    await ctx.record(APP, { name, client_id: (await tokenValue(ctx, `jira-client-id:${id}`)).slice(0, 32), callback_urls: urls, secret_sha256: sha256(ctx, await secretOf(id)) }, id);
    app = ctx.row(APP, id)!;
  }
  return Response.json({ client_id: app.client_id, client_secret: await secretOf(String(app.id)) }, { status: 201 });
}


// source: https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/ "You generate an API token for your Atlassian account"
export async function apiToken(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  if (b.account !== undefined || b.deployment !== undefined || (b.site === undefined && b.email === undefined && b.password === undefined)) return deploymentToken(ctx);
  let site = siteNamed(ctx, b.site);
  if (!site) site = await defaultAccount(ctx, b);
  const held = ctx.rowsRaw(PERSON).find((p) => p.email === b.email && p.deleted !== true);
  if (!site || !held || !(held.sites as string[]).includes(String(site.id)) || held.password_sha256 !== sha256(ctx, String(held.id) + ':' + String(b.password))) return bad('Invalid account or site', 401);
  const runtime = runtimeDefault(b);
  const kept = runtime ? ctx.rowsRaw(API_TOKEN).find((t) => t.deleted !== true && t._worldCredential === true && t.person === held.id && t.site === site!.id) : undefined;
  if (kept) return keptToken(ctx, kept, String(b.email));
  const id = await ctx.issue(API_TOKEN);
  const value = await tokenValue(ctx, 'jira-api:' + id);
  await ctx.record(API_TOKEN, { person: held.id, site: site.id, email: b.email, sha256: sha256(ctx, value), ...(runtime ? { _worldCredential: true } : {}) }, id);
  return Response.json({ apiToken: value, authorization: 'Basic ' + Buffer.from(String(b.email) + ':' + value).toString('base64'), site: site.id, email: held.email, url: site.url }, { status: 201 });
}

const runtimeDefault = (b: Record<string, unknown>): boolean => b.site === 'acme' && b.email === 'agent@acme.example' && b.password === 'world-password';

async function keptToken(ctx: HandlerContext, kept: Record<string, unknown>, email: string): Promise<Response> {
  const value = await tokenValue(ctx, 'jira-api:' + String(kept.id));
  return Response.json({ apiToken: value, authorization: 'Basic ' + Buffer.from(email + ':' + value).toString('base64'), site: kept.site, email, url: ctx.row(SITE, String(kept.site))!.url }, { status: 201 });
}

async function defaultAccount(ctx: HandlerContext, b: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  if (!runtimeDefault(b)) return undefined;
  const sid = ctx.mint(SITE);
  await ctx.record(SITE, { name: 'acme', url: 'https://acme.atlassian.net' }, sid);
  await person(ctx, sid, { name: 'On-call agent', email: b.email, password: b.password }, true);
  return ctx.row(SITE, sid);
}

async function deploymentToken(ctx: HandlerContext): Promise<Response> {
  try {
    const person = await ctx.tenant(PERSON, async (organization) => {
      const email = organization.members[0]!.toLowerCase();
      const held = ctx.rowsRaw(PERSON).find((p) => String(p.email).toLowerCase() === email);
      if (held) return String(held.id);
      const made = await ctx.createUnique(PERSON, (id) => ({ accountId: id, displayName: organization.label, email, active: true, sites: [], admin_of: [] }), 'person.create');
      return String(made.row.id);
    });
    if (person.active === false) return bad('Invalid account or site', 401);
    let site = (person.sites as string[]).map((id) => ctx.row(SITE, id)).find((row) => row);
    if (!site) {
      const organization = await ctx.organization();
      const rule = { max: 63, lower: true, allowed: /[a-z0-9-]/ };
      const label = organization.id.length < 3 ? `site-${organization.id}` : organization.id;
      const create = (suffixed: boolean) => {
        const name = ctx.vendorName(label, rule, { suffixed, identity: organization.id });
        return ctx.createUnique(SITE, { name, url: `https://${name}.atlassian.net` }, 'site.create');
      };
      let made = await create(false);
      if (!made.created) made = await create(true);
      if (!made.created) return bad(`that site name is taken (${organization.id})`, 409);
      const siteId = String(made.row.id);
      await ctx.change(PERSON, String(person.id), (held) => {
        const sites = (held.sites as string[]).filter((id) => ctx.row(SITE, id));
        return sites.length ? undefined : { sites: [siteId], admin_of: [...(held.admin_of as string[]), siteId] };
      }, 'person.site');
      site = (ctx.row(PERSON, String(person.id))!.sites as string[]).map((id) => ctx.row(SITE, id)).find((row) => row)!;
    }
    const siteId = String(site.id);
    const key = await ctx.accountKey('api-token', API_TOKEN, {
      make: async () => {
        const id = await ctx.issue(API_TOKEN);
        const value = await tokenValue(ctx, `jira-api:${id}`);
        await ctx.record(API_TOKEN, { person: person.id, site: siteId, email: person.email, name: ctx.deployment() || 'world', sha256: sha256(ctx, value) }, id);
        return id;
      },
      read: async (row) => {
        if (row.person !== person.id || row.site !== siteId || row.email !== person.email || !(ctx.row(PERSON, String(person.id))!.sites as string[]).includes(siteId)) return undefined;
        const value = await tokenValue(ctx, `jira-api:${row.id}`);
        return sha256(ctx, value) === row.sha256 ? value : undefined;
      },
    });
    return Response.json({ apiToken: key.secret, authorization: 'Basic ' + Buffer.from(`${person.email}:${key.secret}`).toString('base64'), site: siteId, email: person.email, url: site.url }, { status: 201 });
  } catch (error) { if (error instanceof Response) return error; throw error; }
}
