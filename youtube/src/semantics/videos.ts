// The videos family: uploading a video (videos.insert on the upload path, by Google's resumable protocol or one
// multipart request, and the resumable session's PUTs), reading videos back (videos.list by id) and editing their
// metadata (videos.update).
//
// A video's bytes are the pack's blobs (`video:<id>`); a resumable session's chunks are kept as they arrive
// (`upload:<session>:<offset>`) and joined when the last arrives.
import type { HandlerContext } from '@volter/world-core';
import { CHANNEL, SESSION, VIDEO, answerOf, bodyObject, callerChannel, callerOf, channelTitle, idOf, listAnswer, listParam, live, obj, partsOf, query, refuse, videoThumbnails, type Row } from './shared.ts';

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const PRIVACY = ['private', 'public', 'unlisted'];
const LICENSES = ['youtube', 'creativeCommon'];
const OWNER_PARTS = ['fileDetails', 'processingDetails', 'suggestions'];

/** The metadata a videos.insert or videos.update sets, checked as YouTube checks it: the refusal, or nothing. */
function metadataRefusal(ctx: HandlerContext, body: Row, updating: boolean, parts: Set<string>): Response | undefined {
  const snippet = obj(body.snippet);
  const status = obj(body.status);
  if (!updating || parts.has('snippet')) {
    const title = snippet.title;
    // source: https://developers.google.com/youtube/v3/docs/videos "The property value has a maximum length of 100 characters and may contain all valid UTF-8 characters except < and > ."
    // source: https://developers.google.com/youtube/v3/docs/videos/insert "The request metadata specifies an invalid or empty video title."
    if (typeof title !== 'string' || !title.trim() || [...title].length > 100 || /[<>]/.test(title)) return refuse(ctx, 400, 'youtube.video', 'invalidTitle', 'The request metadata specifies an invalid or empty video title.');
    const description = snippet.description;
    // source: https://developers.google.com/youtube/v3/docs/videos "The property value has a maximum length of 5000 bytes and may contain all valid UTF-8 characters except < and > ."
    // source: https://developers.google.com/youtube/v3/docs/videos/insert "The request metadata specifies an invalid video description."
    if (description !== undefined && (typeof description !== 'string' || new TextEncoder().encode(description).byteLength > 5000 || /[<>]/.test(description))) return refuse(ctx, 400, 'youtube.video', 'invalidDescription', 'The request metadata specifies an invalid video description.');
    // source: https://developers.google.com/youtube/v3/docs/videos/update "This property is only required if the request updates the video resource's snippet ."
    // source: https://developers.google.com/youtube/v3/docs/videos/update "The snippet.categoryId property specifies an invalid category ID."
    if (updating && (typeof snippet.categoryId !== 'string' || !/^\d+$/.test(snippet.categoryId))) return refuse(ctx, 400, 'youtube.video', 'invalidCategoryId', 'The snippet.categoryId property specifies an invalid category ID. Use the videoCategories.list method to retrieve supported categories.');
    // source: https://developers.google.com/youtube/v3/docs/videos/insert "The request metadata specifies invalid video keywords."
    if (snippet.tags !== undefined && (!Array.isArray(snippet.tags) || snippet.tags.some((t) => typeof t !== 'string'))) return refuse(ctx, 400, 'youtube.video', 'invalidTags', 'The request metadata specifies invalid video keywords.');
  }
  if (!updating || parts.has('status')) {
    // source: https://developers.google.com/youtube/v3/docs/videos/insert "The request attempts to set an invalid privacy setting for the video."
    if (status.privacyStatus !== undefined && !PRIVACY.includes(String(status.privacyStatus))) return refuse(ctx, 403, 'youtube.video', 'forbiddenPrivacySetting', 'The request attempts to set an invalid privacy setting for the video.');
    // source: https://developers.google.com/youtube/v3/docs/videos/insert "The request attempts to set an invalid license for the video."
    if (status.license !== undefined && !LICENSES.includes(String(status.license))) return refuse(ctx, 403, 'youtube.video', 'forbiddenLicenseSetting', 'The request attempts to set an invalid license for the video.');
    // source: https://developers.google.com/youtube/v3/docs/videos "It can be set only if the privacy status of the video is private."
    // source: https://developers.google.com/youtube/v3/docs/videos/insert "The request metadata specifies an invalid scheduled publishing time."
    if (status.publishAt !== undefined && (status.privacyStatus !== 'private' || Number.isNaN(Date.parse(String(status.publishAt))))) return refuse(ctx, 400, 'youtube.video', 'invalidPublishAt', 'The request metadata specifies an invalid scheduled publishing time.');
  }
  return undefined;
}

/** The snippet a video's metadata sets, with what YouTube adds (its channel, its time, its thumbnails). */
function snippetOf(ctx: HandlerContext, id: string, channel: Row, given: Row, publishedAt: string): Row {
  const title = String(given.title ?? '');
  const description = typeof given.description === 'string' ? given.description : '';
  return {
    publishedAt, channelId: idOf(ctx, channel), title, description, thumbnails: videoThumbnails(id), channelTitle: channelTitle(ctx, channel),
    ...(Array.isArray(given.tags) ? { tags: given.tags } : {}),
    // Where the documentation stops: the pages name no default category for an upload that sets none; the twin keeps
    // the one the request gives, and 22 (the guide's example) when it gives none.
    // source: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol "The categoryId value in the example corresponds to a video category."
    categoryId: given.categoryId !== undefined ? String(given.categoryId) : '22',
    // source: https://developers.google.com/youtube/v3/docs/videos "Its value is none if the video is not an upcoming/active live broadcast."
    liveBroadcastContent: 'none',
    ...(typeof given.defaultLanguage === 'string' ? { defaultLanguage: given.defaultLanguage } : {}),
    localized: { title, description },
  };
}

/** The status a video's metadata sets, around its upload status. */
function statusOf(given: Row, held: Row = {}): Row {
  return {
    uploadStatus: held.uploadStatus ?? 'uploaded',
    ...(held.failureReason ? { failureReason: held.failureReason } : {}),
    // source: https://developers.google.com/youtube/v3/docs/videos/insert "If you don't specify a value for this property, the uploaded video's privacy status defaults to public ."
    privacyStatus: given.privacyStatus ?? 'public',
    ...(given.publishAt !== undefined ? { publishAt: given.publishAt } : {}),
    license: given.license ?? 'youtube',
    embeddable: given.embeddable ?? true,
    // source: https://developers.google.com/youtube/v3/docs/videos "By default, those statistics are viewable"
    publicStatsViewable: given.publicStatsViewable ?? true,
    madeForKids: (given.selfDeclaredMadeForKids ?? held.selfDeclaredMadeForKids) === true,
    ...((given.selfDeclaredMadeForKids ?? held.selfDeclaredMadeForKids) !== undefined ? { selfDeclaredMadeForKids: (given.selfDeclaredMadeForKids ?? held.selfDeclaredMadeForKids) === true } : {}),
    ...((given.containsSyntheticMedia ?? held.containsSyntheticMedia) !== undefined ? { containsSyntheticMedia: (given.containsSyntheticMedia ?? held.containsSyntheticMedia) === true } : {}),
  };
}

/** A video made from an upload's metadata and bytes: kept as YouTube answers it, its bytes the pack's blob, then
 *  processed by YouTube (or failed, for an empty file) as its own move. Answers the video as it stood at the upload's
 *  end, `uploaded`. */
async function makeVideo(ctx: HandlerContext, channel: Row, metadata: Row, bytes: Uint8Array, type: string, operation: string): Promise<Row> {
  const id = ctx.mint(VIDEO);
  await ctx.blobs.put(`video:${id}`, bytes);
  const fields: Row = {
    kind: 'youtube#video', id,
    snippet: snippetOf(ctx, id, channel, obj(metadata.snippet), ctx.occurredAt),
    // Where the documentation stops: the twin does not decode the upload's media, so a video's duration is answered as
    // none (P0D) and its definition as standard.
    contentDetails: { duration: 'P0D', dimension: '2d', definition: 'sd', caption: 'false', licensedContent: false, contentRating: {}, projection: 'rectangular' },
    status: statusOf(obj(metadata.status)),
    statistics: { viewCount: '0', likeCount: '0', favoriteCount: '0', commentCount: '0' },
    // source: https://developers.google.com/youtube/v3/docs/videos "The video's processing status. This value indicates whether YouTube was able to process the video or if the video is still being processed."
    processingDetails: { processingStatus: 'processing' },
    fileDetails: { fileSize: String(bytes.byteLength), fileType: 'video', ...(type ? { container: type } : {}) },
    ...(metadata.recordingDetails && typeof metadata.recordingDetails === 'object' ? { recordingDetails: metadata.recordingDetails } : {}),
    _channel: idOf(ctx, channel), _sub: channel._sub, _size: bytes.byteLength, _type: type,
  };
  await ctx.write(VIDEO, id, fields, operation);
  const uploaded = ctx.row(VIDEO, id)!;
  // YouTube processes what it received: an empty file fails
  // source: https://developers.google.com/youtube/v3/docs/videos "emptyFile"
  const to = bytes.byteLength === 0 ? 'failed' : 'processed';
  const refused = ctx.legal(VIDEO, 'status.uploadStatus', operation, 'uploaded', to, id, 'vendor');
  if (refused) throw new Error(refused.message);
  await ctx.asVendor(() => ctx.write(VIDEO, id, {
    status: { ...obj(fields.status), uploadStatus: to, ...(to === 'failed' ? { failureReason: 'emptyFile' } : {}) },
    processingDetails: { processingStatus: to === 'failed' ? 'failed' : 'succeeded', ...(to === 'failed' ? { processingFailureReason: 'other' } : {}) },
  }, operation));
  return uploaded;
}

/** Whether a video is shown to the caller: a public or unlisted video to anyone, a private one to its owner. */
const visibleTo = (ctx: HandlerContext, video: Row, sub: string | undefined): boolean =>
  video._sub === sub || obj(ctx.own(video).status).privacyStatus !== 'private';

/** The parts a video answer holds for its owner and for anyone else: the file, processing and suggestions parts are the
 *  owner's alone. */
function videoAnswer(ctx: HandlerContext, video: Row, parts: Set<string>): Row {
  return answerOf(ctx, video, parts);
}

// source: https://developers.google.com/youtube/v3/docs/videos/insert "Uploads a video to YouTube and optionally sets the video's metadata."
export async function youtube_videos_insert_simple(ctx: HandlerContext): Promise<Response> {
  const who = callerChannel(ctx);
  if (who instanceof Response) return who;
  const parts = partsOf(ctx);
  const uploadType = query(ctx, 'uploadType');
  if (uploadType === 'resumable') {
    // step 1: the session, its Location the URI the file goes to
    // source: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol "Set the body of the request to a video resource."
    const metadata = bodyObject(ctx);
    const refused = metadataRefusal(ctx, metadata, false, parts);
    if (refused) return refused;
    const size = ctx.call.request.headers.get('x-upload-content-length');
    const type = ctx.call.request.headers.get('x-upload-content-type') ?? '';
    // source: https://developers.google.com/youtube/v3/docs/videos/insert "Accepted Media MIME types: video/* , application/octet-stream"
    if (type && !/^video\/|^application\/octet-stream$/i.test(type)) return refuse(ctx, 400, 'global', 'badContent', 'Media type \'' + type + '\' is not supported. Valid media types: [video/*, application/octet-stream]');
    const session = ctx.mint(SESSION);
    await ctx.record(SESSION, { sub: who.caller.sub, channel: idOf(ctx, who.channel), metadata, part: [...parts].join(','), total: size !== null && /^\d+$/.test(size) ? Number(size) : null, type, received: 0, chunks: [], created: ctx.occurredAt }, session);
    // source: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol "the response will include a Location HTTP header that specifies the URI for the resumable session."
    const location = `${UPLOAD_URL}?uploadType=resumable&upload_id=${session}&part=${[...parts].join(',')}`;
    return new Response(null, { status: 200, headers: { location, 'x-goog-upload-url': location, 'content-length': '0' } });
  }
  if (uploadType === 'multipart') {
    // one request: the video resource, then the file
    const all = await ctx.parts();
    const meta = all.find((p) => /json/i.test(p.type ?? '')) ?? all[0];
    const media = all.find((p) => p !== meta);
    let metadata: Row = {};
    // source: https://developers.google.com/youtube/v3/docs/videos/insert "The request metadata is invalid."
    try { metadata = meta ? obj(JSON.parse(new TextDecoder().decode(meta.body))) : {}; } catch { return refuse(ctx, 400, 'youtube.video', 'invalidVideoMetadata', 'The request metadata is invalid.'); }
    // source: https://developers.google.com/youtube/v3/docs/videos/insert "The request does not include the video content."
    if (!media) return refuse(ctx, 400, 'youtube.video', 'mediaBodyRequired', 'The request does not include the video content.');
    const refused = metadataRefusal(ctx, metadata, false, parts);
    if (refused) return refused;
    const video = await makeVideo(ctx, who.channel, metadata, media.body, media.type ?? '', 'youtube.videos.insert.simple');
    return Response.json(videoAnswer(ctx, video, parts));
  }
  // uploadType=media (the file alone) and a request naming none are the manifest's variants: the gap
  return ctx.gap();
}

// source: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol "After extracting the session URI from the API response, you then need to upload the actual video file content to that location."
export async function youtube_videos_insert_upload(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx);
  if (caller instanceof Response) return caller;
  const id = query(ctx, 'upload_id') ?? '';
  const session = id ? live(ctx.row(SESSION, id)) : undefined;
  // source: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol "If you send a request with an expired session URI, the server returns a 404 HTTP response code ( Not Found )."
  if (!session || session.sub !== caller.sub) return refuse(ctx, 404, 'global', 'notFound', 'Not Found');
  const parts = new Set(String(session.part ?? '').split(',').filter(Boolean));
  // source: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol "If the upload already completed, regardless of whether it succeeded or failed, the API will return the same response that it sent when the upload originally completed."
  if (session.video) {
    const done = live(ctx.row(VIDEO, String(session.video)));
    if (done) return Response.json(videoAnswer(ctx, { ...done, status: obj(session.answeredStatus), processingDetails: obj(session.answeredProcessing) }, parts), { status: 201 });
  }
  const received = Number(session.received ?? 0);
  // source: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol "The header value is indexed from 0 ."
  const progress = (n: number): Record<string, string> => (n > 0 ? { range: `bytes=0-${n - 1}` } : {});
  const bytes = new Uint8Array(await ctx.call.request.arrayBuffer());
  const contentRange = ctx.call.request.headers.get('content-range');
  let total = session.total === null || session.total === undefined ? undefined : Number(session.total);
  let first = 0;
  if (contentRange) {
    const status = /^bytes \*\/(\d+|\*)$/.exec(contentRange.trim());
    // step 4.1: an empty PUT asking how much arrived
    // source: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol "the API response will have an HTTP 308 ( Resume Incomplete ) response code. In the response, the Range header specifies how many bytes of the file have already been successfully uploaded."
    if (status && bytes.byteLength === 0) {
      if (status[1] !== '*') total = Number(status[1]);
      if (total === undefined || received < total) return new Response(null, { status: 308, headers: { ...progress(received), 'content-length': '0' } });
    } else {
      const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(contentRange.trim());
      if (!range) return refuse(ctx, 400, 'global', 'badRequest', 'Failed to parse Content-Range header.');
      first = Number(range[1]);
      if (range[3] !== '*') total = Number(range[3]);
      // source: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol "none of the binary content will be uploaded."
      if (first !== received || Number(range[2]) - first + 1 !== bytes.byteLength) return new Response(null, { status: 308, headers: { ...progress(received), 'content-length': '0' } });
    }
  } else {
    // the whole file in one PUT
    total = bytes.byteLength;
    first = 0;
  }
  let now = received;
  const chunks = Array.isArray(session.chunks) ? [...session.chunks as number[]] : [];
  if (bytes.byteLength > 0 && first === received) {
    await ctx.blobs.put(`upload:${id}:${first}`, bytes);
    chunks.push(first);
    now = received + bytes.byteLength;
  }
  // source: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol "If a request other than the final request succeeds, the API server responds with a 308 ( Resume Incomplete ) response."
  if (total === undefined || now < total) {
    await ctx.record(SESSION, { ...session, received: now, chunks, ...(total !== undefined ? { total } : {}) }, id);
    return new Response(null, { status: 308, headers: { ...progress(now), 'content-length': '0' } });
  }
  // the last byte: the file joined, the video made
  const whole = new Uint8Array(now);
  for (const at of chunks) {
    const part = await ctx.blobs.get(`upload:${id}:${at}`);
    if (part) whole.set(part, at);
  }
  const channel = live(ctx.row(CHANNEL, String(session.channel)));
  if (!channel) return refuse(ctx, 404, 'global', 'notFound', 'Not Found');
  const video = await makeVideo(ctx, channel, obj(session.metadata), whole, String(session.type ?? ''), 'youtube.videos.insert.upload');
  for (const at of chunks) await ctx.blobs.remove(`upload:${id}:${at}`);
  const v = ctx.own(video);
  await ctx.record(SESSION, { ...session, received: now, chunks: [], total, video: v.id, answeredStatus: v.status, answeredProcessing: v.processingDetails }, id);
  // source: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol "The API server responds with an HTTP 201 ( Created ) response code. The body of the response is the video resource that you created."
  return Response.json(videoAnswer(ctx, video, parts), { status: 201 });
}

// source: https://developers.google.com/youtube/v3/docs/videos/list "Returns a list of videos that match the API request parameters."
export async function youtube_videos_list(ctx: HandlerContext): Promise<Response> {
  const parts = partsOf(ctx);
  const ids = listParam(ctx, 'id');
  // chart and myRating are the manifest's variants; the id filter is the one served
  // source: https://developers.google.com/youtube/v3/docs/errors "The request is missing a required parameter."
  if (!ids.length) return refuse(ctx, 400, 'youtube.parameter', 'missingRequiredParameter', 'No filter selected. Expected one of: myRating, chart, id');
  const caller = callerOf(ctx);
  const sub = caller instanceof Response ? undefined : caller.sub;
  const found = ids.map((id) => live(ctx.row(VIDEO, id))).filter((v): v is Row => !!v && visibleTo(ctx, v, sub));
  // source: https://developers.google.com/youtube/v3/docs/videos/list "Note that the fileDetails , processingDetails , and suggestions parts are only available to that video's owner."
  if (OWNER_PARTS.some((p) => parts.has(p)) && found.some((v) => v._sub !== sub)) return refuse(ctx, 403, 'youtube.video', 'forbidden', 'The request is not properly authorized to access video file or processing information. Note that the fileDetails, processingDetails, and suggestions parts are only available to that video\'s owner.');
  // Where the documentation stops: the page lists videoNotFound without saying when the id filter answers it; the API
  // answers the videos it finds among the ids, and an empty list when it finds none (a video the caller may not see,
  // a private one of another channel, is none of them), which clients read by items.length.
  // source: https://developers.google.com/youtube/v3/docs/videos/list "it is not supported for use in conjunction with the id parameter."
  return listAnswer(ctx, 'youtube#videoListResponse', found.map((v) => videoAnswer(ctx, v, parts)), 0, found.length);
}

// source: https://developers.google.com/youtube/v3/docs/videos/update "Note that this method will override the existing values for all of the mutable properties that are contained in any parts that the parameter value specifies."
export async function youtube_videos_update(ctx: HandlerContext): Promise<Response> {
  const who = callerChannel(ctx);
  if (who instanceof Response) return who;
  const parts = partsOf(ctx);
  const body = bodyObject(ctx);
  const id = typeof body.id === 'string' ? body.id : '';
  const video = id ? live(ctx.row(VIDEO, id)) : undefined;
  // source: https://developers.google.com/youtube/v3/docs/videos/update "The video that you are trying to update cannot be found. Check the value of the id field in the request body to ensure that it is correct."
  if (!video || !visibleTo(ctx, video, who.caller.sub)) return refuse(ctx, 404, 'youtube.video', 'videoNotFound', 'The video that you are trying to update cannot be found. Check the value of the id field in the request body to ensure that it is correct.');
  // source: https://developers.google.com/youtube/v3/docs/errors "Access forbidden. The request may not be properly authorized."
  if (video._sub !== who.caller.sub) return refuse(ctx, 403, 'youtube.video', 'forbidden', 'Access forbidden. The request may not be properly authorized.');
  const refused = metadataRefusal(ctx, body, true, parts);
  if (refused) return refused;
  const held = ctx.own(video);
  const change: Row = {};
  if (parts.has('snippet')) {
    const prior = obj(held.snippet);
    change.snippet = snippetOf(ctx, id, who.channel, obj(body.snippet), String(prior.publishedAt ?? ctx.occurredAt));
  }
  // source: https://developers.google.com/youtube/v3/docs/videos/update "The following fields are exempt from this behavior and will only update if explicitly set:"
  // a status part without privacyStatus reverts the video to the default privacy, public, as the page says (an omitted
  // property's value is removed; only selfDeclaredMadeForKids and containsSyntheticMedia are kept)
  // source: https://developers.google.com/youtube/v3/docs/videos/update "If the request body does not specify a value, the existing privacy setting will be removed and the video will revert to the default privacy setting."
  if (parts.has('status')) change.status = statusOf(obj(body.status), obj(held.status));
  if (parts.has('recordingDetails')) change.recordingDetails = obj(body.recordingDetails);
  if (parts.has('localizations')) change.localizations = obj(body.localizations);
  if (Object.keys(change).length) await ctx.write(VIDEO, id, change, 'youtube.videos.update');
  // source: https://developers.google.com/youtube/v3/docs/videos/update "If the parameter value specifies a part that does not contain mutable values, that part will still be included in the API response."
  return Response.json(videoAnswer(ctx, ctx.row(VIDEO, id)!, parts));
}
