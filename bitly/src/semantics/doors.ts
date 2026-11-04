import { passwordHash, type HandlerContext } from '@volter/world-core';
import { accessToken, badRequest, clientSecret, issueAccessToken, readAccessToken } from './shared.ts';

// source: https://dev.bitly.com/docs/getting-started/authentication/ "Register new app"
// Where the documentation stops: this door provisions a synthetic account and its existing default group.
// The branded domain is an account fixture, not a claim that Bitly gives new accounts this domain.
export async function signup(ctx: HandlerContext): Promise<Response> {
  const body = ctx.body as Record<string, unknown>;
  if (body && (body.account !== undefined || body.deployment !== undefined)) return deploymentCredentials(ctx);
  if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') return badRequest();
  const email = body.email.toLowerCase();
  const chosenLogin = String(body.login ?? email.split('@')[0]);
  const hash = passwordHash(email, body.password);
  // Where the documentation stops: this synthetic door resumes an existing account only with its password.
  const person = await ctx.createUnique('_person', { email, login: chosenLogin, password_sha256: hash, created: ctx.occurredAt, modified: ctx.occurredAt }, 'signup', { input: 'omit' });
  const accepted = person.row.password_sha256 === hash;
  if (!accepted) return badRequest();
  const login = String(ctx.rowsRaw('_person').find(row => row.email === email)?.login);

  const { guid, organization } = await defaultGroup(ctx, email, login);
  const redirect_uri = String(body.redirect_uri ?? 'https://app.dub.test/api/callback/bitly');
  const client = await ctx.createUnique('_client', { email, redirect_uri, name: 'Dub' }, 'signup', { input: 'omit' });
  const client_id = String(client.row.id);
  return Response.json({ email, login, group_guid: guid, organization_guid: organization,
    access_token: await accessToken(ctx, email), client_id, client_secret: await clientSecret(ctx, client_id), redirect_uri });
}

async function defaultGroup(ctx: HandlerContext, email: string, login: string): Promise<{ guid: string; organization: string }> {
  const found = ctx.rowsRaw('Group').find(g => g._account === login);
  // source: spec:/components/schemas/Group "organization_guid"
  const registration = await ctx.createUnique('_account_group', { email }, 'signup', { input: 'omit' });
  const guid = String(found?.id ?? registration.row.id);
  const organization = String(found?.organization_guid ?? `O${guid.slice(1)}`);
  if (!found) await ctx.write('Group', guid, {
    guid, organization_guid: organization, name: 'Publisher', created: ctx.occurredAt,
    modified: ctx.occurredAt, is_active: true, role: 'org_admin', bsds: ['chauncey.ly'],
    references: { organization: `https://api-ssl.bitly.com/v4/organizations/${organization}` }, _account: login,
  }, 'signup');
  return { guid, organization };
}

async function deploymentCredentials(ctx: HandlerContext): Promise<Response> {
  try {
    const organizationId = await ctx.account();
    const body = ctx.body as Record<string, unknown>;
    const person = await ctx.tenant('_person', async (organization) => {
      const email = organization.members[0]!.toLowerCase();
      const existing = ctx.rowsRaw('_person').find((row) => row.email === email);
      if (existing) return String(existing.id);
      const rule = { max: Number.MAX_SAFE_INTEGER, lower: true, allowed: /[a-z0-9._-]/, first: /[a-z0-9]/ };
      const create = (suffixed: boolean) => ctx.createUnique('_person', { email, login: ctx.vendorName(organization.id, rule, { suffixed, identity: organization.id }), created: ctx.occurredAt, modified: ctx.occurredAt }, 'signup', { input: 'omit' });
      let made = await create(false);
      if (!made.created && made.row.email === email) return String(made.row.id);
      if (!made.created) made = await create(true);
      if (!made.created) throw Response.json({ message: `BAD_REQUEST (${organization.id})` }, { status: 400 });
      return String(made.row.id);
    });
    const email = String(person.email), login = String(person.login);
    const group = await defaultGroup(ctx, email, login);
    const client = await ctx.deploymentObject(`oauth-client:${String(person.id)}`, '_client', async (deployment) => {
      const made = await ctx.create('_client', { email, redirect_uri: typeof body.redirect_uri === 'string' ? body.redirect_uri : 'https://app.dub.test/api/callback/bitly', name: deployment || organizationId, _owner: person.id }, 'client.create');
      return String(made.id);
    });
    const secret = await ctx.accountKey('client-secret', '_client', {
      make: async () => {
        const before = ctx.row('_client', String(client.id))!;
        const serial = await ctx.issue('_credential_serial');
        await ctx.change('_client', String(client.id), (row) => row._owner === person.id && row._secret_pending !== true && row._secret_label === before._secret_label && row.secret_sha256 === before.secret_sha256
          ? { _secret_label: `bitly-client-secret:${serial}`, _secret_pending: true } : undefined, 'client.secret.reserve', { input: 'omit' });
        const selected = ctx.row('_client', String(client.id))!;
        const value = await clientSecret(ctx, String(client.id));
        await ctx.change('_client', String(client.id), (row) => row._owner === person.id && row._secret_label === selected._secret_label
          ? { secret_sha256: ctx.crypto.sha256(value), _secret_pending: false } : undefined, 'client.secret.issue', { input: 'omit' });
        return String(client.id);
      },
      read: async (row) => {
        if (row.id !== client.id || row._owner !== person.id || row._secret_pending === true) return undefined;
        const value = await clientSecret(ctx, String(row.id));
        return row.secret_sha256 === ctx.crypto.sha256(value) ? value : undefined;
      },
    });
    const token = await ctx.accountKey('user-grant', '_access_token', {
      make: () => issueAccessToken(ctx, email, String(client.id)),
      read: (row) => row.email === email && row.client_id === client.id ? readAccessToken(ctx, row) : Promise.resolve(undefined),
    });
    return Response.json({ email, login, group_guid: group.guid, organization_guid: group.organization, client_id: client.id, client_secret: secret.secret, access_token: token.secret, redirect_uri: client.redirect_uri });
  } catch (error) { if (error instanceof Response) return error; throw error; }
}
