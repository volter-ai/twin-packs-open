// The CDN's downloads: an LFS object's bytes with Range, over ./shared.ts.
import type { HandlerContext } from '@volter/world-core';
import { cdnDownload } from './shared.ts';

export async function screen(ctx: HandlerContext): Promise<Response> { return cdnDownload(ctx); }
