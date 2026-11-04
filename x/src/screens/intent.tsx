// The application's text and URL become an editable draft; opening it publishes nothing.
// X's private composer transport is undocumented: this form posts to its own screen,
// as the consent screens do, and writes the same Post shape as createPosts.
import { isReadOnlyRequest, type HandlerContext } from '@volter/world-core';
import { signedInAccount } from './shared.tsx';
import { flowPage } from '@volter/world-ui';
import { DEFAULT_POST_CHARACTER_LIMIT, emptyPublicMetrics, forbiddenProblem, invalidRequestProblem, NOSTORE, send } from '../semantics/shared.ts';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const query = new URL(request.url).searchParams;
  // source: recording:2026-10-03-tweet-button.html "text:s.text"
  // source: recording:2026-10-03-tweet-button.html "url:s.url"
  for (const key of query.keys()) {
    if (key !== 'text' && key !== 'url') return send(invalidRequestProblem({ [key]: [query.get(key) ?? ''] }, 'This Web Intent parameter is not modelled.'));
  }
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD, POST' } });
  const account = signedInAccount(ctx);
  // The browser signs in through the same X session flow as every other screen.
  if (!account) return send(forbiddenProblem('Sign in to X to post.'));
  const own = ctx.own(account);
  if (request.method === 'POST') {
    if (isReadOnlyRequest(request)) return send(forbiddenProblem('This World is read-only.'));
    const form = new URLSearchParams(ctx.text);
    const text = form.get('text') ?? '';
    // source: recording:2026-10-03-how-to-post.json "Compose your message (up to 280 characters) and select Post."
    // Weighted Unicode counting remains the same documented gap as createPosts.
    if (!text.trim() || Array.from(text).length > DEFAULT_POST_CHARACTER_LIMIT) return send(invalidRequestProblem({ text: [text] }, 'Edit your post to contain 1 to 280 characters.'));
    const id = ctx.mint('Post');
    await ctx.write('post', id, { text, author_id: account.id, created_at: ctx.occurredAt, conversation_id: id, edit_history_tweet_ids: [id], public_metrics: emptyPublicMetrics(), deleted: false }, 'x.post.create');
    // The post-page redirect is a local substitute for X's private web client transport.
    const placed = request.headers.has('x-forwarded-prefix') ? ctx.publicBase.replace(/\/+$/, '') : '';
    return new Response(null, { status: 303, headers: { location: `${placed}/${String(own.username)}/status/${id}`, ...NOSTORE } });
  }
  const text = [query.get('text'), query.get('url')].filter(Boolean).join(' ');
  const page = flowPage({ title: 'Post / X', headers: NOSTORE,
    css: ['body{margin:0;background:#000;color:#e7e9ea;font:16px sans-serif}main{max-width:600px;margin:40px auto;padding:24px}textarea{box-sizing:border-box;width:100%;min-height:160px;background:#000;color:inherit;border:1px solid #536471;font:inherit;padding:12px}button{margin-top:16px;border:0;border-radius:24px;background:#eff3f4;color:#0f1419;padding:12px 24px;font-weight:700}'],
    body: <main><h1>Post</h1><p>@{String(own.username)}</p><form method="post" action=""><label htmlFor="post-text">What is happening?!</label><textarea id="post-text" name="text" defaultValue={text} required /><button type="submit">Post</button></form></main>,
  });
  return request.method === 'HEAD' ? new Response(null, { status: page.status, headers: page.headers }) : page;
}
