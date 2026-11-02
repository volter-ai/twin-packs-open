// The World's doors: what Google Cloud console and a person's first Google sign-in do, outside the API.
//
//   POST /_twin/clients { client_id, client_secret?, redirect_uris, name }         an OAuth client (the console's)
//   POST /_twin/accounts { sub, email, name?, given_name?, family_name?, picture? } a Google account a person chooses
//   POST /_twin/service-accounts { client_email, client_id?, project_id? }         a service account and its key file
//   POST /_twin/credentials { client_email, client?: { redirect_uris, name? }, account?: { sub, email, name? },
//                             api_key?: { name? } }  the World's credentials: the service account, its OAuth client, its
//                                                  person and its project's API key (the credential door)
import type { HandlerContext } from '@volter/world-core';
import { ACCOUNT, API_KEY, CLIENT, SERVICE_ACCOUNT } from './shared.ts';

const bad = (error: string): Response => Response.json({ error }, { status: 400 });
const bodyOf = (ctx: HandlerContext): Record<string, unknown> => (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Record<string, unknown>;

export async function clients(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.client_id !== 'string' || !Array.isArray(b.redirect_uris)) return bad('client_id and redirect_uris are required');
  await ctx.write(CLIENT, b.client_id, { client_id: b.client_id, ...(typeof b.client_secret === 'string' ? { secret: b.client_secret } : {}), redirect_uris: b.redirect_uris, name: b.name ?? b.client_id, support_email: b.support_email ?? null }, 'client.create');
  return Response.json({ client_id: b.client_id }, { status: 201 });
}

export async function accounts(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.sub !== 'string' || !/^\d{21}$/.test(b.sub) || typeof b.email !== 'string') return bad('sub (a 21-digit Google account id) and email are required');
  const name = typeof b.name === 'string' ? b.name : [b.given_name, b.family_name].filter(Boolean).join(' ') || null;
  await ctx.write(ACCOUNT, b.sub, { email: b.email.toLowerCase(), name, given_name: b.given_name ?? null, family_name: b.family_name ?? null, picture: b.picture ?? null }, 'account.create');
  return Response.json({ sub: b.sub }, { status: 201 });
}

/** A service account (answered again for the same email) and its JSON key file, as the Cloud console's "Create key"
 *  downloads it: its private key is a key pair the World makes once, at random, for the account. */
// source: https://cloud.google.com/iam/docs/keys-create-delete "Service account keys"
export async function serviceAccounts(ctx: HandlerContext): Promise<Response> {
  return makeServiceAccount(ctx, bodyOf(ctx));
}

async function makeServiceAccount(ctx: HandlerContext, b: Record<string, unknown>): Promise<Response> {
  if (typeof b.client_email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(b.client_email)) return bad('client_email is required');
  const email = b.client_email;
  const key = await ctx.signingKey(`service-account:${email}`, 'RS256');
  const keyId = ctx.crypto.digest('sha1', key.publicPem, 'hex');
  const held = ctx.row(SERVICE_ACCOUNT, email);
  // Where the documentation stops: a service account's numeric id is 21 digits; the twin's is drawn from its email
  const clientId = typeof b.client_id === 'string' ? b.client_id : String(held?.client_id ?? BigInt(`0x${ctx.crypto.digest('sha256', email, 'hex').slice(0, 16)}`).toString().padStart(21, '1').slice(0, 21));
  const project = typeof b.project_id === 'string' ? b.project_id : email.split('@')[1]?.split('.')[0] ?? 'world-project';
  await ctx.record(SERVICE_ACCOUNT, { client_email: email, client_id: clientId, project_id: project, private_key_id: keyId, public_key: key.publicPem }, email);
  const credentials = {
    type: 'service_account', project_id: project, private_key_id: keyId, private_key: key.privatePem, client_email: email, client_id: clientId,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth', token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(email)}`, universe_domain: 'googleapis.com',
  };
  return Response.json({ client_email: email, credentials }, { status: 201 });
}

/** The World's credentials, the credential door: the application's service account and key file (as `serviceAccounts`),
 *  and, when the body names them, its OAuth client as the Cloud console's Credentials page makes one (a client id and
 *  secret of Google's forms, the redirect URIs it registers) and the World's person, the Google account who consents on
 *  the account chooser. The same body answers the same credentials at every boot. */
// source: https://developers.google.com/identity/protocols/oauth2/web-server "Create authorization credentials"
export async function worldCredentials(ctx: HandlerContext): Promise<Response> {
  const selected = await ctx.account('world_account');
  const suffix = selected === 'default' ? '' : ctx.crypto.digest('sha256', selected, 'hex').slice(0, 24);
  const given = bodyOf(ctx);
  const b: Record<string, unknown> = suffix ? { ...given, client_email: `world-${suffix}@world-${suffix}.iam.gserviceaccount.com`, project_id: `world-${suffix}` } : given;
  const made = await makeServiceAccount(ctx, b);
  if (made.status !== 201) return made;
  const out = await made.json() as Record<string, unknown>;
  const c = b.client && typeof b.client === 'object' ? b.client as Record<string, unknown> : undefined;
  if (c) {
    if (!Array.isArray(c.redirect_uris) || !c.redirect_uris.every((u) => typeof u === 'string')) return bad('client.redirect_uris is required');
    // Where the documentation stops: a client id is 12 digits, a dash and 32 letters and digits before
    // .apps.googleusercontent.com, and a secret GOCSPX- and 28 characters, as the console shows them; the World's are drawn
    // from secrets it holds, so no one computes them from what it shows
    const digits = (await ctx.secret(`googleoauth:world-client:id${suffix ? `:${suffix}` : ''}`)).replace(/\D/g, '').padEnd(12, '7').slice(0, 12);
    const tail = (await ctx.secret(`googleoauth:world-client:name${suffix ? `:${suffix}` : ''}`)).replace(/[^a-z0-9]/g, '').padEnd(32, '0').slice(0, 32);
    const clientId = typeof c.client_id === 'string' ? c.client_id : `${digits}-${tail}.apps.googleusercontent.com`;
    const secret = `GOCSPX-${(await ctx.secret(`googleoauth:client-secret:${clientId}`)).replace(/[^A-Za-z0-9_-]/g, '').padEnd(28, '0').slice(0, 28)}`;
    await ctx.write(CLIENT, clientId, { client_id: clientId, secret, redirect_uris: c.redirect_uris, name: c.name ?? 'World App', support_email: null }, 'client.create');
    Object.assign(out, { client_id: clientId, client_secret: secret });
  }
  const person = b.account && typeof b.account === 'object' ? b.account as Record<string, unknown> : undefined;
  const a: Record<string, unknown> | undefined = person && suffix ? { ...person, sub: BigInt(`0x${ctx.crypto.digest('sha256', selected, 'hex').slice(0, 16)}`).toString().padStart(21, '1').slice(0, 21), email: `person+${suffix}@world.example` } : person;
  if (a) {
    if (typeof a.sub !== 'string' || !/^\d{21}$/.test(a.sub) || typeof a.email !== 'string') return bad('account.sub (a 21-digit Google account id) and account.email are required');
    await ctx.write(ACCOUNT, a.sub, { email: a.email.toLowerCase(), name: a.name ?? null, given_name: a.given_name ?? null, family_name: a.family_name ?? null, picture: a.picture ?? null }, 'account.create');
    Object.assign(out, { sub: a.sub, email: a.email.toLowerCase() });
  }
  const k = b.api_key && typeof b.api_key === 'object' ? b.api_key as Record<string, unknown> : undefined;
  if (k) {
    // the project's API key, as the Credentials page's Create credentials > API key makes it: kept by its SHA-256 (the
    // contract the Google API packs read), the key itself answered to the World's application alone
    // source: https://cloud.google.com/docs/authentication/api-keys-use "To include an API key with a REST API call, use the x-goog-api-key HTTP"
    // Where the documentation stops: a key is AIza and 35 letters, digits, dashes and underscores, as the console shows
    // it; the World's is drawn from a secret it holds, the same key at every boot
    const sa = out.credentials && typeof out.credentials === 'object' ? out.credentials as Record<string, unknown> : {};
    const project = typeof sa.project_id === 'string' ? sa.project_id : 'world-project';
    const key = `AIza${(await ctx.secret(`googleoauth:api-key:${project}`)).replace(/[^A-Za-z0-9_-]/g, '').padEnd(35, '0').slice(0, 35)}`;
    await ctx.write(API_KEY, ctx.crypto.digest('sha256', key, 'hex'), { project, name: typeof k.name === 'string' ? k.name : 'API key 1', created: ctx.occurredAt }, 'api_key.create');
    Object.assign(out, { api_key: key });
  }
  return Response.json(out, { status: 201 });
}
