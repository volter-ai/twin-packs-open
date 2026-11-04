// news.ycombinator.com/submit: a title with a url, or a title with text, posted to POST /r (../semantics/r.ts). Signed
// out, the page says so over the login forms, which post to the submit page's own address (POST /submit,
// ../semantics/submit.ts; news.ycombinator.com/submit, read 2026-10-02: "You have to be logged in to submit.").
import type { HandlerContext } from '@volter/world-core';
import { submitFnid } from '../semantics/shared.ts';
import { loginForms, page, who } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const user = who(ctx);
  if (!user) return loginForms(ctx, 'Submit | Hacker News', 'You have to be logged in to submit.');
  const fnid = await submitFnid(ctx, user);
  return page(ctx, 'Submit | Hacker News', (
    <form method="post" action="r">
      <input type="hidden" name="fnid" value={fnid} />
      <input type="hidden" name="fnop" value="submit-page" />
      <table>
        <tbody>
          <tr><td><label htmlFor="title">title</label></td><td><input type="text" id="title" name="title" size={50} autoFocus /></td></tr>
          <tr><td><label htmlFor="url">url</label></td><td><input type="url" id="url" name="url" size={50} /></td></tr>
          <tr><td><label htmlFor="text">text</label></td><td><textarea id="text" name="text" rows={4} cols={49} /></td></tr>
          <tr><td /><td><input type="submit" value="submit" /></td></tr>
          <tr><td /><td className="hn-sub">Leave url blank to submit a question for discussion. To share something you made, begin the title with Show HN.</td></tr>
        </tbody>
      </table>
    </form>
  ));
}
