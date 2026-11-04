// A video's captions, POSTed as multipart/form-data (its metadata and its SRT file) to the captionsUploadUrl
// initializeUpload answered when uploadCaptions was true.
import type { HandlerContext } from '@volter/world-core';
import { keep, missingField, queryOf, uploadOf, VIDEO } from './shared.ts';

/** POST /dms-mpf-uploads/{asset}/userUploadedCustomCaptions/{caption}/0?ut=: the captions, answered 201. */
export async function uploadVideoCaptions(ctx: HandlerContext): Promise<Response> {
  const asset = String(ctx.call.params.asset);
  const upload = uploadOf(ctx, queryOf(ctx, 'ut'), asset, 'video-captions');
  if (upload instanceof Response) return upload;
  const parts = await ctx.parts();
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "is mandatory to avoid any errors."
  const file = parts.find((p) => p.name === 'file' && p.filename !== null);
  if (!file) return missingField('file');
  if (!parts.some((p) => p.name === 'metadata')) return missingField('metadata');
  const digest = await keep(ctx, file.body);
  // source: spec:/components/schemas/Video/properties "captions"
  await ctx.write(VIDEO, asset, { captions: `https://www.linkedin.com/dms-mpf-uploads/${asset}/userUploadedCustomCaptions/${String(ctx.call.params.captionId)}/0`, _captions_sha256: digest }, 'video.captions');
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "A successful response returns a 201 Created status code."
  return new Response(null, { status: 201 });
}
