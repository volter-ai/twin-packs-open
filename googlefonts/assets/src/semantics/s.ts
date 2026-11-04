import type { HandlerContext } from '@volter/world-core';
import { downloadFont } from './shared.ts';
// source: spec:getFontFile "Download the font-file bytes named by a Google Fonts stylesheet src URL."
export async function getFontFile(ctx: HandlerContext): Promise<Response> { return downloadFont(ctx); }
