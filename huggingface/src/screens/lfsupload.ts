// The CDN's uploads: the batch API's upload href, over ./shared.ts.
import type { HandlerContext } from '@volter/world-core';
import { cdnUpload } from './shared.ts';

export async function screen(ctx: HandlerContext): Promise<Response> { return cdnUpload(ctx); }
