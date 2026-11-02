// Articles (spec:articleCreateDraft, spec:articlePublish): a long post published as an X Article, a draft made
// with its title and body, then published, which makes the Post that carries it (POST /2/articles/draft,
// then POST /2/articles/{id}/publish, whose `post_id` names the post it links to). The draft is the `article` subject,
// its publication the manifest's machine (`article.status`: draft → published, once).
import type { HandlerContext } from '@volter/world-core';
import { emptyPublicMetrics, invalidRequestProblem, isAnswer, mintSnowflakeId, ok, opening, payloadOf, putRev, resolveAttachedMedia, send, type XResponse } from './shared.ts';

const DRAFT_FIELDS = new Set(['title', 'content_state', 'cover_media']);

const refuse = (field: string, value: unknown, message: string): Response => send(invalidRequestProblem({ [field]: [typeof value === 'string' ? value : JSON.stringify(value) ?? ''] }, message));

// source: spec:/components/schemas/ArticleCreateDraftContentStateBlocks/properties/type "The block type. Use atomic for non-text embeds (image, post, markdown, divider, latex)."
const BLOCK_FIELDS = new Set(['data', 'entity_ranges', 'inline_style_ranges', 'key', 'text', 'type']);
const BLOCK_TYPES = new Set(['unstyled', 'header-one', 'header-two', 'header-three', 'unordered-list-item', 'ordered-list-item', 'blockquote', 'atomic']);

/** A block of the body against its closed schema (spec:/components/schemas/ArticleCreateDraftContentStateBlocks,
 *  additionalProperties false: text and type required, a type of its enum, no field it does not name). */
function blockProblem(block: unknown, at: number): Response | undefined {
  const b = (block ?? {}) as Record<string, unknown>;
  const ok = typeof block === 'object' && block !== null && !Array.isArray(block) && Object.keys(b).every((k) => BLOCK_FIELDS.has(k)) && typeof b.text === 'string' && typeof b.type === 'string' && BLOCK_TYPES.has(b.type);
  return ok ? undefined : blockRefused(b, at);
}

/** X's refusal of a block its schema does not take: a field it does not name, no text, or a type outside its enum. */
function blockRefused(b: Record<string, unknown>, at: number): Response {
  const extra = Object.keys(b).find((k) => !BLOCK_FIELDS.has(k));
  if (extra !== undefined) return refuse(`content_state.blocks.${at}.${extra}`, b[extra], `The \`content_state.blocks.${at}.${extra}\` field is not a parameter of this request.`);
  return refuse(`content_state.blocks.${at}`, b, `Each block of \`content_state.blocks\` needs \`text\` and a \`type\` of [${[...BLOCK_TYPES].join(', ')}].`);
}

/** POST /2/articles/draft {title, content_state {blocks, entities}, cover_media?}: "Creates a new Article draft that can
 *  later be published" (201 {data {id, title}}). A cover must be media the account uploaded, as a post's must. */
export async function articleCreateDraft(ctx: HandlerContext): Promise<Response> {
  const open = opening(ctx);
  if (isAnswer(open)) return send(open);
  const b = payloadOf(ctx);
  for (const key of Object.keys(b)) if (!DRAFT_FIELDS.has(key)) return refuse(key, b[key], `The \`${key}\` field is not a parameter of this request.`);
  if (typeof b.title !== 'string' || b.title.length === 0) return refuse('title', b.title, 'The `title` field is required and must not be empty.');
  const state = b.content_state;
  if (!state || typeof state !== 'object' || !Array.isArray(state.blocks) || !Array.isArray(state.entities)) return missingArticleContent(state);
  for (const key of Object.keys(state)) if (key !== 'blocks' && key !== 'entities') return refuse(`content_state.${key}`, state[key], `The \`content_state.${key}\` field is not a parameter of this request.`);
  const blockRefused = state.blocks.map((block: unknown, at: number) => blockProblem(block, at)).find((r: Response | undefined) => r !== undefined);
  if (blockRefused) return blockRefused;
  let cover: Record<string, unknown> | undefined;
  if (b.cover_media !== undefined) { const checkedCover = await articleCover(ctx, open.caller, b.cover_media); if (checkedCover instanceof Response) return checkedCover; cover = checkedCover; }
  const id = mintSnowflakeId(ctx, 'article');
  await putRev(ctx, 'article', id, { title: b.title, content_state: state, ...(cover ? { cover_media: cover } : {}), author_id: open.caller.accountId, status: 'draft', created_at: ctx.occurredAt }, 'x.article.draft');
  return send({ status: 201, body: { data: { id, title: b.title } }, headers: { 'content-type': 'application/json' } });
}

/** POST /2/articles/{article_id}/publish: "Publishes a draft Article, making it publicly visible" ({data {post_id}}):
 *  the Post that carries it, the account's. An Article is its author's: another account's, or one nobody drafted, is
 *  not found. Where the documentation stops: the carrying post's text, the twin's, the Article's title (X shows an
 *  Article's post as its title card). */
export async function articlePublish(ctx: HandlerContext): Promise<Response> {
  const open = opening(ctx);
  if (isAnswer(open)) return send(open);
  const id = ctx.resolve('article', String(ctx.call.params.article_id ?? ''));
  const article = open.all.find((r) => r.type === 'article' && String(r.id) === id && String(r.author_id) === open.caller.accountId);
  if (!article) return send({ status: 404, body: { errors: [{ parameter: 'article_id', resource_id: id, value: id, detail: `Could not find article with article_id: [${id}].`, title: 'Not Found Error', resource_type: 'article', type: 'https://api.x.com/2/problems/resource-not-found' }] }, headers: { 'content-type': 'application/json' } });
  const refused = ctx.legal('article', 'status', 'articlePublish', article.status, 'published', id);
  if (refused) return send(invalidRequestProblem({ article_id: [id] }, refused.message));
  const postId = mintSnowflakeId(ctx);
  const cover = (article.cover_media as { media?: unknown } | undefined)?.media;
  await ctx.write('post', postId, {
    text: String(article.title), author_id: open.caller.accountId, created_at: ctx.occurredAt, conversation_id: postId, article_id: id, edit_history_tweet_ids: [postId], public_metrics: emptyPublicMetrics(),
    ...(cover ? { media: [cover], attachments: { media_keys: [(cover as { media_key: string }).media_key] } } : {}), deleted: false,
  }, 'x.post.article');
  await putRev(ctx, 'article', id, { status: 'published', post_id: postId, published_at: ctx.occurredAt }, 'x.article.publish');
  return send(ok({ data: { post_id: postId } }));
}

function missingArticleContent(state: unknown): Response {
  return refuse('content_state', state, 'The `content_state` field is required: an object with `blocks` and `entities` arrays.');
}

async function articleCover(ctx: HandlerContext, caller: Parameters<typeof resolveAttachedMedia>[1], c: any): Promise<Record<string, unknown> | Response> {
  if (!c || typeof c !== 'object' || typeof c.media_id !== 'string' || typeof c.media_category !== 'string') return refuse('cover_media', c, 'The `cover_media` field must name a `media_id` and its `media_category`.');
  const attached = await resolveAttachedMedia(ctx, caller, { media_ids: [c.media_id] });
  if (isAnswer(attached)) return send(attached as XResponse);
  return { media_id: c.media_id, media_category: c.media_category, media: attached.media[0] };
}
