// news.ycombinator.com/shownew: every Show HN, newest first (showhn.html: "Every Show HN appears on shownew.").
import type { HandlerContext } from '@volter/world-core';
import { showNew } from '../semantics/shared.ts';
import { storyList } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  return storyList(ctx, 'New Show | Hacker News', showNew(ctx), 'shownew');
}
