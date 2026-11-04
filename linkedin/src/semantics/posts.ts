// The Posts API (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api): a post
// made as a member or a company page, read back by its URN or among its author's, and deleted. A post carries text, or
// text with one image or video the Images and Videos APIs uploaded, or an article's link card, or reshares another; a
// post whose media is still processing is submitted for publishing and published when the media is ready
// (shared.ts `settle`).
import type { HandlerContext } from '@volter/world-core';
import {
  accessDenied, bodyOf, callerOf, createPostAs, invalidUrnId, invalidValue, mayActAs, missingField, notFound, POST, postByUrn, postKey, POSTING_ROLES,
  queryOf, refuse, urnOf, view, wrongUrnType, type Caller,
} from './shared.ts';

const VIEW_CONTEXTS = ['READER', 'AUTHOR'];

/** The scopes and roles that let a caller read an author's posts. */
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "Retrieve organizations' posts, comments, and likes. Restricted to organizations in which the authenticated member has one of the following company page roles"
const mayRead = (ctx: HandlerContext, who: Caller, author: string): boolean => mayActAs(ctx, who, author, { organization: ['r_organization_social'], member: ['r_member_social'] }, POSTING_ROLES);

/** POST /rest/posts: a post, answered 201 with its URN in x-restli-id. */
export async function createPost(ctx: HandlerContext): Promise<Response> {
  const who = callerOf(ctx);
  if (who instanceof Response) return who;
  const made = await createPostAs(ctx, who, bodyOf(ctx));
  if (made instanceof Response) return made;
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "The Post is created with a 201 response and the response header x-restli-id contains the Post ID"
  return new Response(null, { status: 201, headers: { 'x-restli-id': made } });
}

/** The URN a path names, decoded, or the refusal of one that is no post's. */
function urnInPath(ctx: HandlerContext): string | Response {
  const urn = String(ctx.call.params.postUrn ?? '');
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "To retrieve posts, use URNs such as: ugcPostUrn (urn:li:ugcPost:{id}) or shareUrn (urn:li:share:{id})."
  if (!urnOf(urn)) return invalidUrnId('postUrn', urn);
  return postKey(urn) ? urn : wrongUrnType('postUrn', urn, 'share or ugcPost');
}

/** The view a read asks for: READER, the published post, unless the author asks for AUTHOR. */
function viewContextOf(ctx: HandlerContext): string | Response {
  const asked = queryOf(ctx, 'viewContext') ?? 'READER';
  return VIEW_CONTEXTS.includes(asked) ? asked : invalidValue('viewContext', asked);
}

/** GET /rest/posts/{urn}: a post, in the view asked for. */
export async function getPost(ctx: HandlerContext): Promise<Response> {
  const who = callerOf(ctx);
  if (who instanceof Response) return who;
  const urn = urnInPath(ctx);
  if (urn instanceof Response) return urn;
  const viewContext = viewContextOf(ctx);
  if (viewContext instanceof Response) return viewContext;
  const row = postByUrn(ctx, urn);
  if (!row) return notFound(`Post ${urn}`);
  if (!mayRead(ctx, who, String(row.author))) return accessDenied(`GET /rest/posts/${encodeURIComponent(urn)}`);
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "By default, viewContext is READER, which specifies the version of the post that has been published and is viewable to a general audience."
  if (viewContext === 'READER' && row.lifecycleState !== 'PUBLISHED') return notFound(`Post ${urn}`);
  return Response.json(view(ctx, row));
}

/** GET /rest/posts?q=author: an author's posts, newest first, a page at a time. */
export async function findPostsByAuthor(ctx: HandlerContext): Promise<Response> {
  const who = callerOf(ctx);
  if (who instanceof Response) return who;
  const author = queryOf(ctx, 'author');
  if (!author) return missingField('author');
  const au = urnOf(author);
  if (!au) return invalidUrnId('author', author);
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "Author of the post (can be either posted from a member or their company page)."
  if (au.type !== 'person' && au.type !== 'organization') return wrongUrnType('author', author, 'person or organization');
  const viewContext = viewContextOf(ctx);
  if (viewContext instanceof Response) return viewContext;
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "To retrieve all posts authored by an organization, r_organization_social permission is required."
  if (!mayRead(ctx, who, author)) return accessDenied('GET /rest/posts?q=author');
  const sortBy = queryOf(ctx, 'sortBy') ?? 'LAST_MODIFIED';
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "LAST_MODIFIED (for last modified time) or CREATED (for created time)."
  if (sortBy !== 'LAST_MODIFIED' && sortBy !== 'CREATED') return invalidValue('sortBy', sortBy);
  const start = Number(queryOf(ctx, 'start') ?? 0);
  const count = Number(queryOf(ctx, 'count') ?? 10);
  if (!Number.isInteger(start) || start < 0) return invalidValue('start', queryOf(ctx, 'start'));
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "The default is 10 and maximum allowed count is 100."
  if (!Number.isInteger(count) || count < 0) return invalidValue('count', queryOf(ctx, 'count'));
  if (count > 100) return refuse(400, `count value ${count} can't be higher than 100`, 'FIELD_VALUE_TOO_HIGH');
  const field = sortBy === 'CREATED' ? 'createdAt' : 'lastModifiedAt';
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "By default, all Posts API finder results are sorted by post last modified time (lastModifiedAt field) in descending order (latest to oldest)."
  const all = ctx.rowsRaw(POST).filter((p) => p.author === author && (viewContext === 'AUTHOR' || p.lifecycleState === 'PUBLISHED'))
    .sort((a, b) => Number(b[field]) - Number(a[field]) || Number(BigInt(String(b.id)) - BigInt(String(a.id))));
  const page = all.slice(start, start + count);
  const next = start + count < all.length
    ? [{ rel: 'next', type: 'application/json', href: `/rest/posts?author=${encodeURIComponent(author)}&count=${count}&q=author&sortBy=${sortBy}&start=${start + count}` }]
    : [];
  return Response.json({ paging: { start, count, links: next }, elements: page.map((p) => view(ctx, p)) });
}

/** DELETE /rest/posts/{urn}: the post gone; a second delete of it is answered the same. */
export async function deletePost(ctx: HandlerContext): Promise<Response> {
  const who = callerOf(ctx);
  if (who instanceof Response) return who;
  const urn = urnInPath(ctx);
  if (urn instanceof Response) return urn;
  const key = postKey(urn)!;
  const held = ctx.row(POST, key, { withDeleted: true });
  if (!held) return notFound(`Post ${urn}`);
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "Post deletions are idempotent. Deletion requests for a previously deleted UGC Post will return a 204 code - No Content."
  if (held.deleted === true) return new Response(null, { status: 204 });
  if (ctx.own(held).id !== urn) return notFound(`Post ${urn}`);
  if (!mayActAs(ctx, who, String(held.author), { organization: ['w_organization_social'], member: ['w_member_social'] }, POSTING_ROLES)) return accessDenied(`DELETE /rest/posts/${encodeURIComponent(urn)}`);
  await ctx.remove(POST, key, 'post.delete');
  return new Response(null, { status: 204 });
}
