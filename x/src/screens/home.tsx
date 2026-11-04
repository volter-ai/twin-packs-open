// x.com's home (a workspace, twin-world's architecture "Screens"): where a signed-in person reads the timeline and writes
// a post. The owner's ruling for the model editor's launch (2026-10-02): posting to X is done by a person through
// x.com's own pages, "primarily going to be UI since posting is not really automated" (journeys/demand.json).
//
//   GET  /home   the "For you" timeline under the composer ("What is happening?!", "Add photos or video", "Post"); a
//                visitor nobody signed in is sent to the sign-in flow, which returns them here (./login.tsx)
//   POST /home   the composer's form: "Add photos or video" uploads the chosen file at once, as x.com's client does, and
//                shows it attached; "Remove media" takes an attachment off the draft; "Post" posts the draft, uploading a
//                file still chosen first, and returns the person to the timeline with "Your post was sent." and its View
//
// Every write is one of X's operations, made as the person (./shared.tsx `asOperation`): an upload is
// initializeMediaUpload, appendMediaUpload per segment and finalizeMediaUpload, then getMediaUploadStatus until a video
// has processed, the API's chunked upload (https://docs.x.com/x-api/media); a post is createPosts, with the uploaded
// media's ids. An image is a `tweet_image`, an MP4 a `tweet_video`, as X's client uploads them. The draft between two
// clicks is the form itself (its text and the attached media ids), as x.com keeps it in the page.
//
// Where the documentation stops: x.com's composer is a client application no document describes; its words and control
// names here are X's own labels (the placeholder, the media button's and the remove button's accessible names, "Post",
// the toast), and the twin's page is a plain form a person submits. help.x.com answers no automated read (403,
// 2026-10-02). X's "Following" tab and its recommendation of "For you" are not modelled (../semantics/shared.ts
// `webHome`). Each segment is 4 MiB: X takes a chunk of at most 5 MB.
import type { HandlerContext, MultipartPart } from '@volter/world-core';
import { appendMediaUpload, finalizeMediaUpload, getMediaUploadStatus, initializeMediaUpload } from '../semantics/media.ts';
import { cardOf, findPost, postCharacterLimit, readMediaRecord, tree, uploadedMediaUrl, webHome, weightedLength } from '../semantics/shared.ts';
import { createPosts } from '../semantics/tweets.ts';
import { asOperation, avatar, esc, htmlPage, moveTo, placeOf, refusalText, shell, signedInAccount, timeline, type XRow } from './shared.tsx';

const SEGMENT_BYTES = 4 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,video/mp4';
const MEDIA_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 5.5C3 4.12 4.12 3 5.5 3h13C19.88 3 21 4.12 21 5.5v13c0 1.38-1.12 2.5-2.5 2.5h-13C4.12 21 3 19.88 3 18.5v-13zM5.5 5c-.28 0-.5.22-.5.5v9.09l3.5-3.5 3 3 5-5 2.5 2.5V5.5c0-.28-.22-.5-.5-.5h-13zM19 15.91l-2.5-2.5-5 5-3-3-3.5 3.5v.59c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5v-2.59zM8 9.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z"/></svg>';

/** What the composer holds between clicks: its text, the media attached, and what the last click was refused with. */
type Draft = { text: string; media: string[]; error?: string };

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const placed = placeOf(ctx);
  const person = signedInAccount(ctx);
  // x.com sends a visitor nobody signed in to its sign-in flow, which returns them here
  if (!person) return moveTo(`/i/flow/login?redirect_after_login=${encodeURIComponent('/home')}`, placed, 307);
  if (request.method === 'GET' || request.method === 'HEAD') {
    // the toast names a post only when it is the person's own, live: an address naming any other id shows none
    const posted = new URL(request.url).searchParams.get('posted') ?? '';
    const own = /^\d{1,19}$/.test(posted) && String(findPost(tree(ctx), posted)?.author_id ?? '') === String(person.id) ? posted : undefined;
    return home(ctx, person, { text: '', media: [] }, placed, own);
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD, POST' } });
  const parts = await ctx.parts();
  const field = (name: string): string => new TextDecoder().decode(parts.find((p) => p.name === name && p.filename === null)?.body ?? new Uint8Array());
  const intent = field('intent');
  // a browser submits a textarea's line breaks as CRLF; x.com's client counts and posts a break as one LF
  const draft: Draft = { text: field('text').replace(/\r\n?/g, '\n'), media: parts.filter((p) => p.name === 'media_id' && p.filename === null).map((p) => new TextDecoder().decode(p.body)).filter((id) => /^\d{1,19}$/.test(id)) };
  // "Remove media": the attachment comes off the draft (x.com's client forgets the id; nothing is sent)
  if (intent.startsWith('remove:')) return home(ctx, person, { ...draft, media: draft.media.filter((id) => id !== intent.slice('remove:'.length)) }, placed);
  // the files chosen with "Add photos or video" (several at once, up to four photos) are uploaded before anything else,
  // each in turn, as x.com's client uploads them at once
  for (const file of parts.filter((p) => p.name === 'media' && p.filename !== null && p.body.length > 0)) {
    const uploaded = await upload(ctx, String(person.id), file);
    if ('error' in uploaded) return home(ctx, person, { ...draft, error: uploaded.error }, placed);
    draft.media.push(uploaded.id);
  }
  if (intent !== 'post') return home(ctx, person, draft, placed);
  // "Post": POST /2/tweets as the person, with the attached media
  const body: Record<string, unknown> = { ...(draft.text !== '' || draft.media.length === 0 ? { text: draft.text } : {}), ...(draft.media.length ? { media: { media_ids: draft.media } } : {}) };
  const answer = await createPosts(asOperation(ctx, 'createPosts', String(person.id), { body }));
  const read = await answer.json().catch(() => ({})) as { data?: { id?: string } };
  // a refused post (empty, over the limit, a video longer than the account may post) keeps the draft and shows X's
  // answer in its own words. Where the documentation stops: x.com's own client keeps Post from sending an empty or an
  // over-limit draft (this page, drawn with no script, cannot), and X publishes no words for either refusal; the words
  // shown are the twin's API answers' (../semantics/tweets.ts textRequired, overLimit), not x.com's
  if (answer.status !== 201 || !read.data?.id) return home(ctx, person, { ...draft, error: refusalText(read) }, placed);
  return moveTo(`/home?posted=${read.data.id}`, placed, 303);
}

/** One file uploaded through X's chunked upload as the person: its media id once processed, or X's refusal in words. */
async function upload(ctx: HandlerContext, accountId: string, file: MultipartPart): Promise<{ id: string } | { error: string }> {
  const type = (file.type ?? '').split(';')[0]!.trim().toLowerCase();
  const category = type.startsWith('video/') ? 'tweet_video' : 'tweet_image';
  const call = async (answered: Promise<Response>): Promise<{ ok: boolean; body: Record<string, any> }> => {
    const res = await answered;
    return { ok: res.ok, body: await res.json().catch(() => ({})) as Record<string, any> };
  };
  const init = await call(initializeMediaUpload(asOperation(ctx, 'initializeMediaUpload', accountId, { body: { media_type: type, total_bytes: file.body.length, media_category: category } })));
  const id = init.body.data?.id;
  if (!init.ok || typeof id !== 'string') return { error: refusalText(init.body) };
  for (let at = 0, index = 0; at < file.body.length; at += SEGMENT_BYTES, index += 1) {
    const segment = file.body.subarray(at, at + SEGMENT_BYTES);
    const appended = await call(appendMediaUpload(asOperation(ctx, 'appendMediaUpload', accountId, { params: { id }, body: { media: Buffer.from(segment).toString('base64'), segment_index: index } })));
    if (!appended.ok) return { error: refusalText(appended.body) };
  }
  let state = await call(finalizeMediaUpload(asOperation(ctx, 'finalizeMediaUpload', accountId, { params: { id } })));
  // a video processes: its status is read until it has succeeded or failed, as X's client polls it
  for (let reads = 0; state.ok && !state.body.errors && ['pending', 'in_progress'].includes(state.body.data?.processing_info?.state) && reads < 10; reads += 1) {
    state = await call(getMediaUploadStatus(asOperation(ctx, 'getMediaUploadStatus', accountId, { query: { command: 'STATUS', media_id: id } })));
  }
  if (!state.ok || state.body.errors || state.body.data?.processing_info?.state === 'failed') return { error: refusalText(state.body) };
  return { id };
}

/** The home page: the composer over the timeline. */
function home(ctx: HandlerContext, person: XRow, draft: Draft, placed: string | undefined, posted?: string): Response {
  const all = tree(ctx);
  const read = webHome(all);
  const attached = draft.media.map((id) => readMediaRecord(ctx, id)).filter((r) => r !== undefined);
  const previews = attached.map((r) => {
    const url = uploadedMediaUrl(r);
    const shown = !url ? '' : r.media_category.endsWith('video') ? `<video src="${esc(url)}#t=0.001" controls playsinline preload="metadata"></video>` : `<img src="${esc(url)}" alt="Image">`;
    return `<div class="attachment" data-media-id="${esc(r.id)}">${shown}<button type="submit" class="remove-media" name="intent" value="remove:${esc(r.id)}" aria-label="Remove media">×</button><input type="hidden" name="media_id" value="${esc(r.id)}"></div>`;
  }).join('');
  const toast = posted && /^\d{1,19}$/.test(posted)
    ? `<div class="toast" role="status"><span>Your post was sent.</span><a href="/${esc(person.username)}/status/${esc(posted)}">View</a></div>` : '';
  // how far over the account's limit a draft is, counted as X counts (../semantics/shared.ts weightedLength). x.com's own
  // client shows it beside Post and keeps Post from posting it; this page is drawn with no script, so the count is drawn
  // when the page is, Post stays a button the person can press, and X's refusal of a post over the limit is shown in the
  // composer, the draft kept for editing. Where the documentation stops: x.com's composer is a client no document
  // describes, and its words for a refused post are not published; the composer shows X's answer's own words.
  const over = weightedLength(draft.text) - postCharacterLimit(person);
  const composer = `<form id="composer" class="composer" method="post" action="/home" enctype="multipart/form-data">${avatar(person, 40)}<div class="composer-body">`
    + `<textarea name="text" aria-label="Post text" data-testid="tweetTextarea_0" placeholder="What is happening?!">${esc(draft.text)}</textarea>`
    + (previews ? `<div class="attachments attachments-${attached.length}">${previews}</div>` : '')
    + (draft.error ? `<div class="composer-error" role="alert">${esc(draft.error)}</div>` : '')
    + '<div class="composer-bar">'
    + `<label class="media-button" aria-label="Add photos or video" title="Media">${MEDIA_ICON}<input class="visually-hidden" type="file" name="media" data-testid="fileInput" accept="${ACCEPT}" multiple onchange="this.form.requestSubmit(document.getElementById('attach'))"></label>`
    + '<button type="submit" id="attach" class="visually-hidden" name="intent" value="attach" tabindex="-1">Attach</button>'
    + (over > 0 ? `<span class="char-count over" aria-live="polite">-${over}</span>` : '')
    + '<button type="submit" class="post-button" name="intent" value="post" data-testid="tweetButtonInline">Post</button>'
    + '</div></div></form>';
  const column = '<div class="home-tabs" role="tablist"><span class="tab active" role="tab" aria-selected="true">For you</span></div>'
    + toast + composer + timeline(read, (p) => cardOf(all, p), Date.parse(ctx.occurredAt));
  return htmlPage(shell('Home / X', column, person), placed, 200, {}, ctx.call.request);
}
