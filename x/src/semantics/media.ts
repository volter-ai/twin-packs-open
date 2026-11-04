// Media upload (https://docs.x.com/x-api/media): the chunked `initialize` {media_type, total_bytes, media_category},
// `append` {media, segment_index} and `finalize`, and `GET /2/media/upload?command=STATUS&media_id=` for the processing
// state, as twitter-api-v2's uploadMedia and a client's own chunked upload send them. The one-shot `POST /2/media/upload`
// is called by no application here and answers the gap. Every one needs `media.write` (the spec's scopes). The twin models STILL IMAGES (`tweet_image`, `dm_image`)
// and MP4 VIDEO (`tweet_video`, `amplify_video`); GIF, DM video and subtitle categories are documented X surface it
// refuses by name.
//
// An upload is not a post: the bytes are the context's blobs and the session is an `upload` subject no read serves
// (shared.ts, media), and only the post that attaches the media id makes anything public. Each move of a session's state
// asks the manifest's machine (`upload.state`: initialized → processing | succeeded | failed; processing → succeeded).
//
// PROCESSING. An image is usable the moment its bytes are whole. A video is not: FINALIZE answers `processing_info`
// {state: "pending", check_after_secs}, and the client polls STATUS until the state is `succeeded` (or `failed`). The
// twin walks the same states, one per STATUS read (pending → in_progress → succeeded), so a client that polls as X asks
// reaches `succeeded`, and a client that posts without polling is refused as X refuses it. Time moves it too: one step
// per `check_after_secs` of World-clock time since FINALIZE, whichever is sooner, so a client that sleeps as told and
// then posts, without polling, is not refused.
import { type HandlerContext, isReadOnlyRequest } from '@volter/world-core';
import { clearSegments, invalidRequestProblem, VIDEO_CATEGORIES, isAnswer, mintSnowflakeId, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MIN_VIDEO_MS, MEDIA_EXPIRES_AFTER_SECS, moveRefused, nowSeconds, ok, opening, payloadOf, processingStep, putSegment, putXBlob, readMediaRecord, readSegments, send, settled, sniffImage, sniffVideo, canUse, CHECK_AFTER_SECS, INVALID_MEDIA_IDS, isVideoCategory, urlOf, writeMediaRecord, type Caller, type XMediaRecord, type XResponse } from './shared.ts';

/** A multipart body, read as BYTES (`ctx.parts()`): its text fields and the `media` part's bytes. A WHATWG `formData()`
 *  parse turns a part that names no filename into a UTF-8 string, corrupting the bytes, and twitter-api-v2's
 *  FormDataHelper (what `client.v2.uploadMedia` sends each APPEND with) names none. */
type MultipartForm = { fields: Record<string, string>; media?: Uint8Array };
async function formOf(ctx: HandlerContext): Promise<MultipartForm | undefined> {
  if (!/^multipart\/form-data/i.test(ctx.call.request.headers.get('content-type') ?? '')) return undefined;
  const fields: Record<string, string> = {};
  let media: Uint8Array | undefined;
  for (const part of await ctx.parts()) {
    if (part.name === 'media') media = part.body;
    else fields[part.name] = new TextDecoder().decode(part.body);
  }
  return { fields, ...(media ? { media } : {}) };
}

/** X's media categories, as its refusal of another names them. The ones a session keeps are IMAGE_CATEGORIES and
 *  ./shared.ts VIDEO_CATEGORIES; the rest (a GIF, a DM's video, subtitles), like the media types beside IMAGE_TYPES and
 *  VIDEO_TYPES and a `shared` media id, are the manifest's variants (../manifest.ts UPLOAD_VARIANTS), answered the gap
 *  before the handler runs. */
// source: spec:/components/schemas/InitializeMediaUploadRequest/properties/media_category "The media category of the upload."
const MEDIA_CATEGORIES_DOCUMENTED = ['amplify_video', 'dm_gif', 'dm_image', 'dm_video', 'subtitles', 'tweet_gif', 'tweet_image', 'tweet_video'];
/** The body fields each upload operation's spec declares (spec:initializeMediaUpload, spec:appendMediaUpload); any
 *  other is not a parameter of the request. */
const INITIALIZE_FIELDS = new Set(['media_type', 'total_bytes', 'media_category', 'additional_owners', 'shared']);
const APPEND_FIELDS = new Set(['media', 'segment_index']);
const IMAGE_CATEGORIES = new Set(['tweet_image', 'dm_image']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4']);



/** A field of the upload body, from the multipart form or the JSON object. */
function uploadField(form: MultipartForm | undefined, payload: Record<string, any>, name: string): unknown {
  return form ? form.fields[name] : payload[name];
}

/** A multipart APPEND that carries no `media` part: the field the spec requires. */
function noMediaPart(): XResponse {
  return invalidRequestProblem({ media: [''] }, 'The `media` field is required.');
}

/** The `media` bytes: the multipart part as sent, or the JSON body's base64 decoded. */
function uploadBytes(form: MultipartForm | undefined, payload: Record<string, any>): Uint8Array | XResponse {
  if (form) return form.media && form.media.length > 0 ? form.media : noMediaPart();
  const raw = payload.media;
  if (typeof raw !== 'string' || raw.trim() === '') return invalidRequestProblem({ media: [String(raw ?? '')] }, 'The `media` field is required.');
  const clean = raw.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return invalidRequestProblem({ media: ['(not base64)'] }, 'The `media` field of a JSON body must be base64-encoded bytes.');
  return new Uint8Array(Buffer.from(clean, 'base64'));
}

function parseCategory(value: unknown): string | XResponse {
  if (typeof value !== 'string' || value === '') return invalidRequestProblem({ media_category: [String(value ?? '')] }, 'The `media_category` field is required.');
  if (!IMAGE_CATEGORIES.has(value) && !VIDEO_CATEGORIES.has(value)) return invalidRequestProblem({ media_category: [value] }, `The \`media_category\` value [${value}] is not one of [${MEDIA_CATEGORIES_DOCUMENTED.join(', ')}]`);
  return value;
}

/** `additional_owners`: an array on initialize. */
function parseOwners(value: unknown): string[] | XResponse {
  return value === undefined || value === null || value === '' ? [] : ownersNamed(value);
}

/** The accounts `additional_owners` names, each an X user id. */
function ownersNamed(value: unknown): string[] | XResponse {
  const list = Array.isArray(value) ? value.map(String) : String(value).split(',').map((v) => v.trim()).filter((v) => v !== '');
  for (const id of list) {
    if (!/^\d{1,19}$/.test(id)) return invalidRequestProblem({ additional_owners: [id] }, `The \`additional_owners\` value [${id}] does not match ^[0-9]{1,19}$`);
  }
  return list;
}

/** A field the operation's closed schema does not declare: the vendor's invalid-request refusal. */
function unknownField(present: string[], allowed: Set<string>): XResponse | undefined {
  const extra = present.find((name) => !allowed.has(name));
  return extra === undefined ? undefined : invalidRequestProblem({ [extra]: [extra] }, `The \`${extra}\` field is not a parameter of this request.`);
}

function bodyFieldNames(form: MultipartForm | undefined, payload: Record<string, any>): string[] {
  return form ? [...Object.keys(form.fields), ...(form.media ? ['media'] : [])] : Object.keys(payload);
}

/** X's `processing_info`: state, progress_percent and check_after_secs, nothing else (the schema's three fields). A
 *  failure's reason rides the answer's `errors`, not in here. */
function processingInfo(record: XMediaRecord): Record<string, unknown> | undefined {
  if (record.state === 'failed') return { state: 'failed', progress_percent: 0 };
  if (!isVideoCategory(record.media_category)) return record.state === 'succeeded' ? undefined : { state: 'pending', progress_percent: 0, check_after_secs: CHECK_AFTER_SECS };
  if (record.state === 'succeeded') return { state: 'succeeded', progress_percent: 100 };
  if (record.state === 'processing' && (record.processing_step ?? 0) >= 1) return { state: 'in_progress', progress_percent: 50, check_after_secs: CHECK_AFTER_SECS };
  return { state: 'pending', progress_percent: 0, check_after_secs: CHECK_AFTER_SECS };
}

/** What X answers about a media object: its id, key, remaining lifetime, and (once whole) its size, its image or video
 *  facts and, while a video processes and on STATUS, `processing_info`. */
function mediaAnswer(record: XMediaRecord, ctx: HandlerContext, status = false): Record<string, unknown> {
  const data: Record<string, unknown> = { id: record.id, media_key: record.media_key, expires_after_secs: Math.max(0, record.expires_at - nowSeconds(ctx)) };
  if (record.size !== undefined) data.size = record.size;
  if (record.sha256 && !isVideoCategory(record.media_category)) data.image = { image_type: record.media_type, w: record.width, h: record.height };
  if (record.sha256 && isVideoCategory(record.media_category) && record.state !== 'failed') data.video = { video_type: record.media_type };
  const info = processingInfo(record) ?? (status ? { state: 'succeeded', progress_percent: 100 } : undefined);
  if (info && (status || isVideoCategory(record.media_category) || record.state === 'failed')) data.processing_info = info;
  // a failed processing run is the answer's `errors`, the one place the schema puts a reason
  const errors = record.state === 'failed'
    ? [{ title: 'Invalid Request', detail: record.error ?? 'Invalid or Unsupported media.', type: 'https://api.x.com/2/problems/invalid-request' }]
    : undefined;
  return { data, ...(errors ? { errors } : {}) };
}

/** Whole bytes against the category: what they are, or why X would not take them. An image that is not one is refused
 *  on the request; a video X would take the upload of and then FAIL in processing, so a bad video becomes a `failed`
 *  record rather than a refused request. */
function finishUpload(record: XMediaRecord, bytes: Uint8Array): XMediaRecord | XResponse {
  if (!isVideoCategory(record.media_category)) {
    if (bytes.length > MAX_IMAGE_BYTES) return invalidRequestProblem({ media: [String(bytes.length)] }, `The image is ${bytes.length} bytes, over X's ${MAX_IMAGE_BYTES}-byte limit for an image.`);
    const info = sniffImage(bytes);
    if (!info) return invalidRequestProblem({ media: [`(${bytes.length} bytes)`] }, 'The `media` bytes are not a supported image (JPEG, PNG, GIF or WebP).');
    return { ...record, state: 'succeeded', media_type: info.mediaType, size: bytes.length, width: info.width, height: info.height };
  }
  if (bytes.length > MAX_VIDEO_BYTES) return invalidRequestProblem({ media: [String(bytes.length)] }, `The video is ${bytes.length} bytes, over X's ${MAX_VIDEO_BYTES}-byte limit for a video.`);
  const video = sniffVideo(bytes);
  const failed = (message: string): XMediaRecord => ({ ...record, state: 'failed', size: bytes.length, error: message });
  if (!video) return failed('Invalid or Unsupported media, Reason: the file is not an MP4 with a video track.');
  if (video.durationMs < MIN_VIDEO_MS) return failed(tooShort(video.durationMs));
  return { ...record, state: 'processing', processing_step: 0, media_type: video.mediaType, size: bytes.length, width: video.width, height: video.height, duration_ms: video.durationMs };
}

/** Why X's processing fails a video shorter than half a second. */
function tooShort(durationMs: number): string {
  return `Invalid or Unsupported media, Reason: Duration too short, minimum:${MIN_VIDEO_MS / 1000}, actual:${(durationMs / 1000).toFixed(3)}`;
}

/** A media id, one of X's snowflakes, from the same space as its posts and accounts (the kernel's mint, ./shared.ts). */
function mintMediaId(ctx: HandlerContext): string {
  return mintSnowflakeId(ctx, 'upload');
}

/** X's media-key prefix names the kind: 3_ a photo, 7_ a posted video, 13_ an Amplify video. */
function mediaKeyFor(category: string, id: string): string {
  return `${category === 'tweet_video' ? '7' : category === 'amplify_video' ? '13' : '3'}_${id}`;
}

/** The bytes checked and stored, and the session moved to where they leave it (the machine asked first). */
async function storeFinished(ctx: HandlerContext, operation: string, record: XMediaRecord, bytes: Uint8Array): Promise<XMediaRecord | XResponse> {
  const checked = finishUpload(record, bytes);
  if (isAnswer(checked)) return checked;
  const refused = moveRefused(ctx, operation, record, checked.state);
  if (refused) return refused;
  const stored = await putXBlob(ctx, bytes);
  const finished: XMediaRecord = { ...checked, sha256: stored.sha256, ...(checked.state === 'processing' ? { finalized_at: nowSeconds(ctx) } : {}) };
  await writeMediaRecord(ctx, finished);
  return finished;
}


/** A `media_type` none of the spec's enum names. */
function undocumentedMediaType(mediaType: unknown): XResponse {
  return invalidRequestProblem({ media_type: [String(mediaType ?? '')] }, `The \`media_type\` value [${String(mediaType ?? '')}] is not one of the documented media types`);
}

/** A `total_bytes` that is not a byte count. */
function badTotalBytes(total: unknown): XResponse {
  return invalidRequestProblem({ total_bytes: [String(total ?? '')] }, 'The `total_bytes` field is required and must be a non-negative integer.');
}

/** POST /2/media/upload/initialize: open a chunked upload. */
export async function initializeMediaUpload(ctx: HandlerContext): Promise<Response> {
  const open = opening(ctx);
  if (isAnswer(open)) return send(open);
  const payload = payloadOf(ctx);
  const extra = unknownField(Object.keys(payload), INITIALIZE_FIELDS);
  if (extra) return send(extra);
  // a media id shared across accounts is documented and not modelled: `true` is the manifest's variant, never ignored
  if (payload.shared !== undefined && typeof payload.shared !== 'boolean') return send(invalidRequestProblem({ shared: [String(payload.shared)] }, 'The `shared` field must be a boolean.'));
  const category = parseCategory(payload.media_category);
  if (typeof category !== 'string') return send(category);
  const mediaType = payload.media_type;
  if (typeof mediaType !== 'string' || (!IMAGE_TYPES.has(mediaType) && !VIDEO_TYPES.has(mediaType))) return send(undocumentedMediaType(mediaType));
  const video = isVideoCategory(category);
  if (video !== VIDEO_TYPES.has(mediaType)) return send(invalidRequestProblem({ media_type: [mediaType] }, `The \`media_type\` [${mediaType}] does not match the \`media_category\` [${category}].`));
  const total = payload.total_bytes;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) return send(badTotalBytes(total));
  const ceiling = video ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (total > ceiling) return send(invalidRequestProblem({ total_bytes: [String(total)] }, `A${video ? ' video' : 'n image'} may be at most ${ceiling} bytes.`));
  const owners = parseOwners(payload.additional_owners);
  if (!Array.isArray(owners)) return send(owners);
  const id = mintMediaId(ctx);
  const record: XMediaRecord = {
    id, media_key: mediaKeyFor(category, id), account_id: open.caller.accountId, media_category: category, media_type: mediaType, state: 'initialized', total_bytes: total,
    ...(owners.length > 0 ? { additional_owners: owners } : {}),
    created_at: ctx.occurredAt, expires_at: nowSeconds(ctx) + MEDIA_EXPIRES_AFTER_SECS,
  };
  await writeMediaRecord(ctx, record);
  return send(ok({ data: { id, media_key: record.media_key, expires_after_secs: MEDIA_EXPIRES_AFTER_SECS } }));
}

/** An upload session this account started and may still write to, or X's refusal of the id. */
async function openSession(ctx: HandlerContext, caller: Caller, id: string, operation: string, to: string | undefined): Promise<XMediaRecord | XResponse> {
  const record = readMediaRecord(ctx, id);
  if (!record || record.account_id !== caller.accountId || record.expires_at <= nowSeconds(ctx)) return invalidRequestProblem({ media_id: [id] }, INVALID_MEDIA_IDS);
  // a session no longer initialized takes no segment and no second finalize: the machine's refusal
  return moveRefused(ctx, operation, record, to) ?? record;
}

/** A `segment_index` outside 0 to 999. */
function badSegmentIndex(rawIndex: unknown): XResponse {
  return invalidRequestProblem({ segment_index: [String(rawIndex ?? '')] }, 'The `segment_index` field is required and must be an integer between 0 and 999.');
}

/** POST /2/media/upload/{id}/append: one segment. */
export async function appendMediaUpload(ctx: HandlerContext): Promise<Response> {
  const open = opening(ctx);
  if (isAnswer(open)) return send(open);
  const payload = payloadOf(ctx);
  const form = await formOf(ctx);
  const extra = unknownField(bodyFieldNames(form, payload), APPEND_FIELDS);
  if (extra) return send(extra);
  const id = String(ctx.call.params.id ?? '');
  const record = await openSession(ctx, open.caller, id, 'appendMediaUpload', undefined);
  if (isAnswer(record)) return send(record);
  const rawIndex = uploadField(form, payload, 'segment_index');
  const index = typeof rawIndex === 'number' ? rawIndex : typeof rawIndex === 'string' && /^\d+$/.test(rawIndex) ? Number(rawIndex) : Number.NaN;
  if (!Number.isInteger(index) || index < 0 || index > 999) return send(badSegmentIndex(rawIndex));
  const bytes = uploadBytes(form, payload);
  if (!(bytes instanceof Uint8Array)) return send(bytes);
  await putSegment(ctx, record, index, bytes);
  return send(ok({ data: { expires_at: record.expires_at } }));
}

/** A FINALIZE of a session already finalized: the machine's refusal. */
function finalizedAgain(ctx: HandlerContext, record: XMediaRecord): XResponse | undefined {
  return moveRefused(ctx, 'finalizeMediaUpload', record, 'succeeded');
}

/** Segments that do not add up to the `total_bytes` INITIALIZE declared. */
function segmentsShort(id: string, size: number, declared: number | undefined): XResponse {
  return invalidRequestProblem({ media_id: [id] }, `The uploaded segments total ${size} bytes; initialize declared ${declared}.`);
}

/** POST /2/media/upload/{id}/finalize: the segments joined, checked, and stored. */
export async function finalizeMediaUpload(ctx: HandlerContext): Promise<Response> {
  const open = opening(ctx);
  if (isAnswer(open)) return send(open);
  const id = String(ctx.call.params.id ?? '');
  const record = readMediaRecord(ctx, id);
  if (!record || record.account_id !== open.caller.accountId || record.expires_at <= nowSeconds(ctx)) return send(invalidRequestProblem({ media_id: [id] }, INVALID_MEDIA_IDS));
  const finalized = record.state === 'initialized' ? undefined : finalizedAgain(ctx, record);
  if (finalized) return send(finalized);
  const segments = await readSegments(ctx, record);
  const size = segments.reduce((n, s) => n + s.length, 0);
  if (segments.length === 0 || size !== record.total_bytes) return send(segmentsShort(id, size, record.total_bytes));
  const whole = new Uint8Array(size);
  let at = 0;
  for (const segment of segments) { whole.set(segment, at); at += segment.length; }
  const finished = await storeFinished(ctx, 'finalizeMediaUpload', record, whole);
  if (isAnswer(finished)) return send(finished);
  await clearSegments(ctx, record);
  return send(ok(mediaAnswer(finished, ctx)));
}

/** GET /2/media/upload?command=STATUS&media_id=: where processing stands. A read of a processing video advances it one
 *  state, on top of whatever the clock has already moved it; read-only, the clock alone moves it. */
export async function getMediaUploadStatus(ctx: HandlerContext): Promise<Response> {
  const open = opening(ctx);
  if (isAnswer(open)) return send(open);
  const url = urlOf(ctx);
  const command = url.searchParams.get('command');
  if (command !== null && command !== 'STATUS') return send(invalidRequestProblem({ command: [command] }, `The \`command\` query parameter value [${command}] is not one of [STATUS]`));
  const id = url.searchParams.get('media_id') ?? '';
  if (!/^\d{1,19}$/.test(id)) return send(invalidRequestProblem({ media_id: [id] }, `The \`media_id\` query parameter value [${id}] does not match ^[0-9]{1,19}$`));
  const stored = readMediaRecord(ctx, id);
  if (!stored || !canUse(stored, open.caller) || stored.expires_at <= nowSeconds(ctx)) return send(invalidRequestProblem({ media_id: [id] }, INVALID_MEDIA_IDS));
  let record = settled(stored, ctx);
  const readOnly = isReadOnlyRequest(ctx.call.request);
  if (record.state === 'processing' && !readOnly) {
    const bumped = { ...record, processing_step: (stored.processing_step ?? 0) + 1 };
    const step = processingStep(bumped, ctx);
    const to = step >= 2 ? 'succeeded' : 'processing';
    if (!moveRefused(ctx, 'getMediaUploadStatus', record, to)) record = to === 'succeeded' ? { ...bumped, state: 'succeeded', processing_step: step } : { ...bumped, processing_step: step };
  }
  // the upload's processing is X's own move whoever asks its status
  if (!readOnly && (record.state !== stored.state || record.processing_step !== stored.processing_step)) await ctx.asVendor(() => writeMediaRecord(ctx, record));
  return send(ok(mediaAnswer(record, ctx, true)));
}

