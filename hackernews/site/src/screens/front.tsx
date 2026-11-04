// news.ycombinator.com/: the site's own address is the front page; a path the site does not have is Unknown.
// (news.ycombinator.com/nosuchpagezz answers "Unknown." as text, 404, read 2026-10-02).
import type { HandlerContext } from '@volter/world-core';
import { frontPage } from '../semantics/shared.ts';
import { nowOf, storyList, unknownPage } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const path = new URL(ctx.call.request.url).pathname.replace(/\/+$/, '');
  return path === '' ? storyList(ctx, 'Hacker News', frontPage(ctx, nowOf(ctx)), 'news') : unknownPage();
}
