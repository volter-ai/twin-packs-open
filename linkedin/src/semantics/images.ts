// The Images API (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api): an
// image registered by initializeUpload, its bytes PUT to the URL LinkedIn answers (dms-uploads.ts), processed, and read
// back with its status and download URL.
import type { HandlerContext } from '@volter/world-core';
import { assetOf, bodyOf, callerOf, holds, IMAGE, imageForbidden, MEDIA_ROLES, notFound, rolesOn, startImageUpload, mediaView } from './shared.ts';

/** POST /rest/images?action=initializeUpload: the upload declared. */
export async function initializeImageUpload(ctx: HandlerContext): Promise<Response> {
  const who = callerOf(ctx);
  if (who instanceof Response) return who;
  const value = await startImageUpload(ctx, who, bodyOf(ctx));
  if (value instanceof Response) return value;
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-09 "A successful response returns a 200 OK status code with the uploadUrl to upload the image."
  return Response.json({ value });
}

/** GET /rest/images/{urn}: the image and where its processing stands. */
export async function getImage(ctx: HandlerContext): Promise<Response> {
  const who = callerOf(ctx);
  if (who instanceof Response) return who;
  const asset = assetOf('imageUrn', ctx.call.params.imageUrn, 'image');
  if (asset instanceof Response) return asset;
  const image = ctx.row(IMAGE, asset);
  if (!image) return notFound(`Image ${String(ctx.call.params.imageUrn)}`);
  const owner = String(image.owner);
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-09 "tokens with only w_member_social permissions would be unable to perform a GET call for rest/images."
  const reads = holds(who, ['rw_ads', 'w_organization_social', 'w_power_creators']);
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-09 "For images with member URN owners, the caller must match the image owner."
  const owns = owner.startsWith('urn:li:organization:') ? rolesOn(ctx, who.person, owner).some((r) => MEDIA_ROLES.includes(r)) : owner === who.person;
  if (!reads || !owns) return imageForbidden();
  return Response.json(await mediaView(ctx, image));
}
