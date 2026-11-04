// POST /submit: the submit page drawn for a visitor nobody is signed in as carries the login forms, which post to the
// submit page's own address (../../spec/openapi.json); signed in, the site answers the submit page itself.
import type { HandlerContext } from '@volter/world-core';
import { signIn, submitAgain } from './shared.ts';

export async function submitLogin(ctx: HandlerContext): Promise<Response> {
  // source: https://news.ycombinator.com/submit "You have to be logged in to submit."
  // source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(newslog ip user 'submit-login) (submit-page user url title showtext text)"
  return signIn(ctx, 'submit', undefined, { answer: (user) => submitAgain(ctx, user, '') });
}
