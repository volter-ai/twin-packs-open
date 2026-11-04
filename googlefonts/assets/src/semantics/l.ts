import type { HandlerContext } from '@volter/world-core';
import { downloadFont } from './shared.ts';
// source: spec:getLegacyFontFile "Download the font-file bytes named by a Google Fonts stylesheet src URL for a legacy browser."
export async function getLegacyFontFile(ctx: HandlerContext): Promise<Response> { return downloadFont(ctx); }
