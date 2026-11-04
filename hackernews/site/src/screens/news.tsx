// news.ycombinator.com/news: the front page, its stories ranked by points and age at the World's instant.
import type { HandlerContext } from '@volter/world-core';
import { frontPage } from '../semantics/shared.ts';
import { nowOf, storyList } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  return storyList(ctx, 'Hacker News', frontPage(ctx, nowOf(ctx)), 'news');
}
