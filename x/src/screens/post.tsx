// x.com's post page (the manifest's `post` screen): what x.com serves at `https://x.com/<handle>/status/<id>`, from the
// twin's own store. An application that posts links the person to it (as
// `https://twitter.com/${profile}/status/${id}`, moved to x.com by ./web.ts), and a person who posted from x.com's composer
// opens it from the toast's View (./home.tsx); it shows the post as X does: author, text, media, its link's card, time.
// The page reads the same projection the API serves (../semantics/shared.ts `webPost`) and is drawn by ./shared.tsx.
import type { HandlerContext } from '@volter/world-core';
import { xSemantics } from '../semantics/index.ts';
import { createPosts } from '../semantics/tweets.ts';
import { answerPage, asOperation, engage, ENGAGE, moveTo, pageOptions, plainNotFound, postPage, refusalText, signedInAccount } from './shared.tsx';

const STATUS = /^\/([A-Za-z0-9_]{1,15})\/status\/([0-9]{1,19})\/?$/;

// x.com's controls under the post, pressed (./shared.tsx `actions`): Reply opens the composer here (`?compose=reply`)
// and its Reply posts the person's text as a reply, createPosts with `reply.in_reply_to_tweet_id`, the spec's
// CreatePostsRequest; Repost, Like and Bookmark are each the API's operation as the person (./shared.tsx `engage`). A
// visitor nobody signed in is sent to the sign-in flow, which returns them here.
// source: spec:/components/schemas/CreatePostsReply "in_reply_to_tweet_id"
export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  const status = STATUS.exec(url.pathname);
  if (!status) return plainNotFound();
  const options = pageOptions(ctx);
  if (request.method === 'GET' || request.method === 'HEAD') {
    return answerPage(request, { ...options, compose: url.searchParams.get('compose') === 'reply' }, () => postPage(status[1]!, status[2]!, { ...options, compose: url.searchParams.get('compose') === 'reply' }));
  }
  if (request.method !== 'POST') return plainNotFound();
  const person = signedInAccount(ctx);
  const page = `/${status[1]}/status/${status[2]}`;
  if (!person) return moveTo(`/i/flow/login?redirect_after_login=${encodeURIComponent(page)}`, options.placed, 303);
  const form = new URLSearchParams(ctx.text);
  const intent = form.get('intent') ?? '';
  if (intent === 'reply') {
    const text = form.get('text') ?? '';
    const answer = await createPosts(asOperation(ctx, 'createPosts', String(person.id), { body: { text, reply: { in_reply_to_tweet_id: status[2] } } }));
    const read = await answer.json().catch(() => ({})) as { data?: { id?: string } };
    if (answer.status === 201 && read.data?.id) return moveTo(`/${String(person.username)}/status/${read.data.id}`, options.placed, 303);
    // a refused reply keeps the composer open with the person's text and X's answer
    const kept = { ...options, compose: true, draft: text, notice: refusalText(read) };
    return answerPage(request, kept, () => postPage(status[1]!, status[2]!, kept));
  }
  if (!ENGAGE[intent] || intent === 'follow') return plainNotFound();
  const said = await engage(ctx, xSemantics, intent, person, { tweet_id: status[2] });
  if (!said) return moveTo(page, options.placed, 303);
  const shown = { ...options, notice: said };
  return answerPage(request, shown, () => postPage(status[1]!, status[2]!, shown));
}
