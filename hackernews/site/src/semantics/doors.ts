// Hacker News gives a person one site login, shared by the organization's deployments.
import type { HandlerContext } from '@volter/world-core';
import { accountRefusal, accountWith, makeAccount, USER, WORLD_ACCOUNT } from './shared.ts';

export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  try {
    const organization = await ctx.organization();
    const email = organization.members[0]!.toLowerCase();
    const password = async (row: Record<string, unknown>): Promise<string> => (await ctx.secret(typeof row._password_label === 'string' ? row._password_label : `hn-password:${String(row.id)}`)).slice(0, 20);
    const user = await ctx.tenant(USER, async org => {
      const existing = ctx.rowsRaw(USER).find(row => row._member_email === email);
      if (existing && accountWith(ctx, String(existing.id), await password(existing))) return String(existing.id);
      const local = email.split('@')[0]!;
      const label = org.id === 'default' ? WORLD_ACCOUNT : local.length < 2 ? `user-${local}` : local;
      const rule = { max: 15, allowed: /[A-Za-z0-9_-]/ };
      const create = async (suffixed: boolean): Promise<string | Response> => {
        const acct = ctx.vendorName(label, rule, { suffixed, identity: org.id });
        const secretLabel = org.id === 'default' ? `hn-password:${acct}` : `hn-password:${email}:${acct}`;
        const pw = (await ctx.secret(secretLabel)).slice(0, 20);
        const held = ctx.row(USER, acct);
        if (org.id === 'default' && acct === WORLD_ACCOUNT && (held?._member_email === undefined || held._member_email === email) && accountWith(ctx, acct, pw)) {
          await ctx.write(USER, acct, { _member_email: email, _password_label: secretLabel }, 'user.email');
          return acct;
        }
        const refused = accountRefusal(ctx, acct, pw);
        if (!refused && await makeAccount(ctx, acct, pw)) {
          await ctx.write(USER, acct, { _member_email: email, _password_label: secretLabel }, 'user.email');
          return acct;
        }
        return ctx.refuse({ status: 200, message: `${refused ?? 'That username is taken. Please choose another.'} (${org.id})` });
      };
      let made = await create(false);
      if (made instanceof Response) made = await create(true);
      if (made instanceof Response) throw made;
      return made;
    });
    const acct = String(user.id), pw = await password(user);
    if (!accountWith(ctx, acct, pw)) return ctx.refuse({ status: 200, message: `Bad login. (${organization.id})` });
    return Response.json({ acct, pw }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
