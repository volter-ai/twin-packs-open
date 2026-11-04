// A push (git-receive-pack), the repository's owner's, over ./shared.ts.
import type { HandlerContext } from '@volter/world-core';
import { smartHttp } from './shared.ts';

export async function screen(ctx: HandlerContext): Promise<Response> { return smartHttp(ctx, 'git-receive-pack'); }
