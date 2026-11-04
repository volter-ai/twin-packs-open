// The Videos API (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api): a
// video registered by initializeUpload, its parts PUT to the URLs LinkedIn answers (dms-uploads.ts), linked by
// finalizeUpload with their ETags, processed by LinkedIn, and read back with its status until it is AVAILABLE.
import type { HandlerContext } from '@volter/world-core';
import { assetOf, bodyOf, callerOf, finishVideoUpload, mayUseVideo, notFound, startVideoUpload, VIDEO, videoForbidden, mediaView } from './shared.ts';

/** POST /rest/videos?action=initializeUpload: the upload declared. */
export async function initializeVideoUpload(ctx: HandlerContext): Promise<Response> {
  const who = callerOf(ctx);
  if (who instanceof Response) return who;
  const value = await startVideoUpload(ctx, who, bodyOf(ctx));
  if (value instanceof Response) return value;
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "A successful response returns a 200 OK status code with the uploadUrl to upload the video."
  return Response.json({ value });
}

/** POST /rest/videos?action=finalizeUpload: the parts linked and the video processing. */
export async function finalizeVideoUpload(ctx: HandlerContext): Promise<Response> {
  const who = callerOf(ctx);
  if (who instanceof Response) return who;
  const refused = await finishVideoUpload(ctx, who, bodyOf(ctx));
  if (refused) return refused;
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "A successful response returns the 200 OK status code."
  return new Response(null, { status: 200 });
}

/** GET /rest/videos/{urn}: the video and where its processing stands. */
export async function getVideo(ctx: HandlerContext): Promise<Response> {
  const who = callerOf(ctx);
  if (who instanceof Response) return who;
  const asset = assetOf('videoUrn', ctx.call.params.videoUrn, 'video');
  if (asset instanceof Response) return asset;
  const video = ctx.row(VIDEO, asset);
  if (!video) return notFound(`Video ${String(ctx.call.params.videoUrn)}`);
  if (!mayUseVideo(ctx, who, String(video.owner))) return videoForbidden();
  return Response.json(await mediaView(ctx, video));
}
