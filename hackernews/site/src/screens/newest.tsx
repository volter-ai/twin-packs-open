// news.ycombinator.com/newest: every story, newest first, where a submission is first seen.
import type { HandlerContext } from '@volter/world-core';
import { newest } from '../semantics/shared.ts';
import { storyList } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  return storyList(ctx, 'New Links | Hacker News', newest(ctx), 'newest');
}
