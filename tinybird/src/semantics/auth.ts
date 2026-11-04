// `GET /v0/auth`: whether the credential is valid, and whether it is a person's user token (`tb workspace delete` asks
// this of the user token it is given before it deletes anything).
import type { HandlerContext } from '@volter/world-core';
import { answer } from './shared.ts';

export async function check_auth_login(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'any', (_req, _query, _token, caller) => ({ status: 200, body: caller.kind === 'user' ? { is_valid: true, is_user: true, user: { email: caller.email } } : { is_valid: true, is_user: false } }));
}
