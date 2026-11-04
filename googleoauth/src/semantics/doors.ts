// The World's doors: what Google Cloud console and a person's first Google sign-in do, outside the API.
//
//   POST /_twin/clients { client_id, client_secret?, redirect_uris, name }         an OAuth client (the console's)
//   POST /_twin/accounts { sub, email, name?, given_name?, family_name?, picture? } a Google account a person chooses
//   POST /_twin/service-accounts { client_email, client_id?, project_id? }         a service account and its key file
//   POST /_twin/credentials { client_email, client?: { redirect_uris, name? }, account?: { sub, email, name? },
//                             api_key?: { name? } }  the World's credentials: the service account, its OAuth client, its
//                                                  person and its project's API key (the credential door)
import type { HandlerContext } from '@volter/world-core';
import { googleSubFor } from '../google-account-id.ts';
import { ACCOUNT, API_KEY, CLIENT, credential, serial, SERVICE_ACCOUNT, SERVICE_ACCOUNT_KEY, type Row } from './shared.ts';

const bad = (error: string): Response => Response.json({ error }, { status: 400 });
const bodyOf = (ctx: HandlerContext): Record<string, unknown> => (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Record<string, unknown>;

export async function clients(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.client_id !== 'string' || !Array.isArray(b.redirect_uris)) return bad('client_id and redirect_uris are required');
  await ctx.write(CLIENT, b.client_id, { client_id: b.client_id, ...(typeof b.client_secret === 'string' ? { secret: b.client_secret } : {}), redirect_uris: b.redirect_uris, name: b.name ?? b.client_id, support_email: b.support_email ?? null }, 'client.create');
  return Response.json({ client_id: b.client_id }, { status: 201 });
}

async function ensureGoogleAccount(ctx: HandlerContext, sub: string, fields: Row): Promise<Row | Response> {
  const made = await ctx.createUnique(ACCOUNT, { id: sub, ...fields }, 'account.create', { id: sub });
  const account = ctx.row(ACCOUNT, sub)!;
  if (account.email !== fields.email) return Response.json({ error: 'ALREADY_EXISTS', error_description: `Google account ${sub} belongs to another email (${String(fields.email)})` }, { status: 409 });
  return made.created ? account : ctx.write(ACCOUNT, sub, fields, 'account.update');
}

export async function accounts(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.sub !== 'string' || !/^\d{21}$/.test(b.sub) || typeof b.email !== 'string') return bad('sub (a 21-digit Google account id) and email are required');
  const name = typeof b.name === 'string' ? b.name : [b.given_name, b.family_name].filter(Boolean).join(' ') || null;
  const made = await ensureGoogleAccount(ctx, b.sub, { email: b.email.toLowerCase(), name, given_name: b.given_name ?? null, family_name: b.family_name ?? null, picture: b.picture ?? null });
  return made instanceof Response ? made : Response.json({ sub: b.sub }, { status: 201 });
}

/** A service account (answered again for the same email) and its JSON key file, as the Cloud console's "Create key"
 *  downloads it: its private key is a key pair the World makes once, at random, for the account. */
// source: https://cloud.google.com/iam/docs/keys-create-delete "Service account keys"
export async function serviceAccounts(ctx: HandlerContext): Promise<Response> {
  return makeServiceAccount(ctx, bodyOf(ctx));
}

async function makeServiceAccount(ctx: HandlerContext, b: Row): Promise<Response> {
  if (typeof b.client_email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(b.client_email)) return bad('client_email is required');
  const account = ctx.row(SERVICE_ACCOUNT, b.client_email) ?? await createServiceAccount(ctx, b.client_email, typeof b.project_id === 'string' ? b.project_id : b.client_email.split('@')[1]!.split('.')[0]!, typeof b.client_id === 'string' ? b.client_id : undefined);
  if (account instanceof Response) return account;
  let key = ctx.rowsRaw(SERVICE_ACCOUNT_KEY).find((row) => row._service_account === account.id);
  if (!key && typeof account.public_key === 'string') key = { ...account, _service_account: account.id, _key_label: `service-account:${String(account.client_email)}` };
  let credentials = key && await serviceAccountCredentials(ctx, account, key);
  if (!credentials) {
    const id = await makeServiceAccountKey(ctx, account);
    credentials = await serviceAccountCredentials(ctx, account, ctx.row(SERVICE_ACCOUNT_KEY, id)!);
  }
  return Response.json({ client_email: account.client_email, credentials: JSON.parse(credentials!) }, { status: 201 });
}

async function createServiceAccount(ctx: HandlerContext, email: string, project: string, givenClientId?: string): Promise<Row | Response> {
  const clientId = givenClientId ?? BigInt(`0x${ctx.crypto.digest('sha256', email, 'hex').slice(0, 16)}`).toString().padStart(21, '1').slice(0, 21);
  const made = await ctx.createUnique(SERVICE_ACCOUNT, { client_email: email, client_id: clientId, project_id: project }, 'service_account.create', { id: email });
  return made.created ? ctx.row(SERVICE_ACCOUNT, email)! : Response.json({ error: 'ALREADY_EXISTS', error_description: `Service account ${email} already exists` }, { status: 409 });
}

async function makeServiceAccountKey(ctx: HandlerContext, account: Row): Promise<string> {
  const label = `service-account-key:${await serial(ctx, 'service-account-key')}`;
  const key = await ctx.signingKey(label, 'RS256');
  const id = ctx.crypto.digest('sha1', key.publicPem, 'hex');
  await ctx.record(SERVICE_ACCOUNT_KEY, { _service_account: account.id, _key_label: label, private_key_id: id, public_key: key.publicPem }, id);
  return id;
}

async function serviceAccountCredentials(ctx: HandlerContext, account: Row, nativeKey: Row): Promise<string | undefined> {
  if (nativeKey._service_account !== account.id || typeof nativeKey._key_label !== 'string') return undefined;
  const key = await ctx.signingKey(nativeKey._key_label, 'RS256');
  if (key.publicPem !== nativeKey.public_key || ctx.crypto.digest('sha1', key.publicPem, 'hex') !== nativeKey.private_key_id) return undefined;
  return JSON.stringify({
    type: 'service_account', project_id: account.project_id, private_key_id: nativeKey.private_key_id, private_key: key.privatePem, client_email: account.client_email, client_id: account.client_id,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth', token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(String(account.client_email))}`, universe_domain: 'googleapis.com',
  });
}

/** Project-owned service-account, OAuth client and API keys; the consenting Google person remains shared. */
export async function worldCredentials(ctx: HandlerContext): Promise<Response> {
  try {
    const b = bodyOf(ctx);
    const organizationId = await ctx.account();
    const organization = await ctx.organization();
    const memberEmail = organization.members[0]!.toLowerCase();
    const memberSub = googleSubFor(memberEmail);
    const existingMember = ctx.row(ACCOUNT, memberSub);
    const member = await ensureGoogleAccount(ctx, memberSub, { email: memberEmail, name: existingMember?.name ?? memberEmail, given_name: existingMember?.given_name ?? null, family_name: existingMember?.family_name ?? null, picture: existingMember?.picture ?? null });
    if (member instanceof Response) return member;
    const project = await ctx.tenant('_project', async (organization) => {
      const label = typeof b.project_id === 'string' ? b.project_id : organization.id === 'default' ? 'world-project' : organization.id;
      const rule = { max: 30, lower: true, allowed: /[a-z0-9-]/, first: /[a-z]/ };
      const projectName = (suffixed: boolean): string => ctx.vendorName(label.length < 6 ? `world-${label}` : label, rule, { suffixed: suffixed || !/[a-z0-9]$/.test(label), identity: organization.id }).replace(/-+/g, '-');
      const create = (name: string) => ctx.createUnique('_project', { project_id: name, name: organization.label, owner: organization.members[0]! }, 'project.create', { id: name });
      let made = await create(projectName(false));
      if (!made.created) made = await create(projectName(true));
      if (!made.created) throw Response.json({ error: 'ALREADY_EXISTS', error_description: `Cloud project already exists (${organization.id})` }, { status: 409 });
      return String(made.row.id);
    });
    const account = await ctx.deploymentObject(`service-account:${String(project.id)}`, SERVICE_ACCOUNT, async (deployment) => {
      const label = deployment || (typeof b.client_email === 'string' ? b.client_email.split('@')[0]! : 'world-app');
      const identity = deployment === '' ? organizationId : `${organizationId}/${deployment}`;
      const rule = { max: 30, lower: true, allowed: /[a-z0-9-]/, first: /[a-z]/ };
      const email = (suffixed: boolean): string => `${ctx.vendorName(label.length < 6 ? `world-${label}` : label, rule, { suffixed: suffixed || !/[a-z0-9]$/.test(label), identity }).replace(/-+/g, '-')}@${String(project.id)}.iam.gserviceaccount.com`;
      let made = await createServiceAccount(ctx, email(false), String(project.id));
      if (made instanceof Response) made = await createServiceAccount(ctx, email(true), String(project.id));
      if (made instanceof Response) throw Response.json({ error: 'ALREADY_EXISTS', error_description: `Service account already exists (${identity})` }, { status: 409 });
      return String(made.id);
    });
    const serviceKey = await ctx.accountKey('service-account-key', SERVICE_ACCOUNT_KEY, {
      make: () => makeServiceAccountKey(ctx, account),
      read: (row) => serviceAccountCredentials(ctx, account, row),
    });
    const out: Row = { client_email: account.client_email, credentials: JSON.parse(serviceKey.secret) };
    const c = b.client && typeof b.client === 'object' ? b.client as Row : undefined;
    if (c) {
      if (!Array.isArray(c.redirect_uris) || !c.redirect_uris.every((u) => typeof u === 'string')) return bad('client.redirect_uris is required');
      const client = await ctx.deploymentObject(`oauth-client:${String(project.id)}`, CLIENT, async (deployment) => {
        const n = await serial(ctx, 'oauth-client');
        const digits = (await ctx.secret(`googleoauth:client-id:${n}`)).replace(/\D/g, '').padEnd(12, '7').slice(0, 12);
        const tail = (await ctx.secret(`googleoauth:client-name:${n}`)).replace(/[^a-z0-9]/g, '').padEnd(32, '0').slice(0, 32);
        const id = `${digits}-${tail}.apps.googleusercontent.com`;
        await ctx.write(CLIENT, id, { client_id: id, secret: await credential(ctx, 'GOCSPX-', `client-secret:${n}`, 28), redirect_uris: c.redirect_uris, name: c.name ?? (deployment || 'World App'), support_email: null, _project: project.id }, 'client.create');
        return id;
      });
      const secret = await ctx.accountKey('oauth-client-secret', CLIENT, {
        make: async () => {
          if (typeof client.secret !== 'string') await ctx.write(CLIENT, String(client.id), { secret: await credential(ctx, 'GOCSPX-', `client-secret:${await serial(ctx, 'client-secret')}`, 28) }, 'client.secret_reset');
          return String(client.id);
        },
        read: async (row) => row.id === client.id && row._project === project.id && typeof row.secret === 'string' ? row.secret : undefined,
      });
      Object.assign(out, { client_id: client.client_id, client_secret: secret.secret });
    }
    const person = b.account && typeof b.account === 'object' ? b.account as Row : undefined;
    if (person) {
      if (typeof person.sub !== 'string' || !/^\d{21}$/.test(person.sub) || typeof person.email !== 'string') return bad('account.sub (a 21-digit Google account id) and account.email are required');
      const made = await ensureGoogleAccount(ctx, person.sub, { email: person.email.toLowerCase(), name: person.name ?? null, given_name: person.given_name ?? null, family_name: person.family_name ?? null, picture: person.picture ?? null });
      if (made instanceof Response) return made;
      Object.assign(out, { sub: person.sub, email: person.email.toLowerCase() });
    }
    const k = b.api_key && typeof b.api_key === 'object' ? b.api_key as Row : undefined;
    if (k) {
      const key = await ctx.accountKey('api-key', API_KEY, {
        make: async () => {
          const label = `api-key:${await serial(ctx, 'api-key')}`;
          const value = await credential(ctx, 'AIza', label, 35);
          const id = ctx.crypto.sha256(value);
          await ctx.write(API_KEY, id, { project: project.id, name: typeof k.name === 'string' ? k.name : 'API key 1', created: ctx.occurredAt, _secret_label: label }, 'api_key.create');
          return id;
        },
        read: async (row) => {
          if (row.project !== project.id || typeof row._secret_label !== 'string') return undefined;
          const value = await credential(ctx, 'AIza', row._secret_label, 35);
          return ctx.crypto.sha256(value) === row.id ? value : undefined;
        },
      });
      out.api_key = key.secret;
    }
    return Response.json(out, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
