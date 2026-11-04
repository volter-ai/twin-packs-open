// A fetch or clone's pack (git-upload-pack), over ./shared.ts.
import type { HandlerContext } from '@volter/world-core';
import { smartHttp } from './shared.ts';

export async function screen(ctx: HandlerContext): Promise<Response> { return smartHttp(ctx, 'git-upload-pack'); }
