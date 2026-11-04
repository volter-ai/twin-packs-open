// Reddit's /comments family: a post and its comment tree.
import type { HandlerContext } from '@volter/world-core';
import { commentsPage } from './shared.ts';

// source: spec:GET_comments_article "Get the comment tree for a given Link article."
export async function GET_comments_article(ctx: HandlerContext): Promise<Response> {
  return commentsPage(ctx, undefined);
}
