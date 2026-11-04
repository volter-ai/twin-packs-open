// POST /r: the submit page's form (../../spec/openapi.json).
import type { HandlerContext } from '@volter/world-core';
import { expiredLink, loginPage, moveTo, postStory, repostOf, signedInAs, submissionRefusal, submitAgain, submitFnid, voteOnce } from './shared.ts';

export async function submit(ctx: HandlerContext): Promise<Response> {
  const user = signedInAs(ctx);
  // source: https://news.ycombinator.com/submit "You have to be logged in to submit."
  if (!user) return loginPage(ctx, 'You have to be logged in to submit.', 'submit');
  // a form whose link is not this person's is no link the site made for them
  if (String(ctx.params.fnid ?? '') !== await submitFnid(ctx, user)) return expiredLink(ctx, user);
  const title = String(ctx.params.title ?? '').trim();
  const url = String(ctx.params.url ?? '').trim();
  const text = String(ctx.params.text ?? '').trim();
  const repost = url ? repostOf(ctx, url) : undefined;
  // source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(do (vote-for user it) (item-url it!id))"
  if (repost) {
    await voteOnce(ctx, user, repost);
    return moveTo(ctx, `item?id=${String(repost.id)}`);
  }
  const refused = submissionRefusal(title, url, text);
  if (refused) return submitAgain(ctx, user, refused, { title, url, text });
  await postStory(ctx, user, { title, ...(url ? { url } : {}), ...(text ? { text } : {}) });
  // source: https://news.ycombinator.com/showhn.html "Every Show HN appears on shownew."
  // source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(maybe-ban-ip s) \"newest\"))))"
  return moveTo(ctx, 'newest');
}
