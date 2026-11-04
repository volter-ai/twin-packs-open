// A MEMBER'S FEED — www.linkedin.com/feed/ (a workspace, docs/contributing/architecture.md, "Screens"): the share box
// ("Start a post", "Video", "Photo"), which opens the post composer (/feed/?shareActive=true, LinkedIn's own address for
// it), and the posts of the member and of the pages they post for, newest first. The composer's Post button makes the
// post through LinkedIn's own operations, as the member and with the page roles they hold: a photo through the Images
// API's initializeUpload and its upload, a video through the Videos API's initializeUpload, its part uploads and
// finalizeUpload, then the Posts API's create (../semantics/shared.ts). A video is processed before its post is
// published; the feed says so meanwhile.
import type { HandlerContext } from '@volter/world-core';
import {
  audiencesFor, COMMENTARY_MAX, createPostAs, postByUrn, mediaSigner, finishVideoUpload, littleText, memberCaller, nowMs, putImage, putVideoPart, shareBoxKind, startImageUpload, startVideoUpload, typedText, urnOf,
  type Row,
} from '../semantics/shared.ts';
import { Avatar, type Body, cannotDisplay, field, GlobalNav, mayManage, memberOf, page, pagesOf, postsBy, seeOther, toSignIn, Update, whileProcessing } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const member = memberOf(ctx);
  // the feed is /feed/ itself; a path under it the pack does not draw (a post's page is ./post.tsx) is LinkedIn's
  // page-not-found
  if (!member) return toSignIn(ctx);
  if (!/^\/feed\/?$/.test(new URL(ctx.call.request.url).pathname)) return cannotDisplay(ctx, member, 'Page not found', 'This page doesn’t exist');
  if (ctx.call.request.method === 'POST') return share(ctx, member);
  return feed(ctx, member);
}

/** A file the person attached to a post they have not posted yet, kept while they change who it is posted as: its
 *  bytes in the World's blobs under the member and their digest, its name and type as their browser sent them. */
type Draft = { key: string; name: string; type: string };

/** The feed, with the composer open when asked for, or with the person's draft (and the words of a refused post). */
async function feed(ctx: HandlerContext, member: Row, refused?: string, typed?: { actor: string; commentary: string; visibility: string; attached?: Draft }): Promise<Response> {
  const composing = refused !== undefined || typed !== undefined || field(ctx, 'shareActive') === 'true';
  const pages = pagesOf(ctx, member);
  const person = `urn:li:person:${String(member.sub)}`;
  const authors = new Set([person, ...pages.map((o) => `urn:li:organization:${String(o.id)}`)]);
  // the post just made, named by its URN alone
  const named = field(ctx, 'posted');
  const made = /^urn:li:(?:share|ugcPost):\d+$/.test(named) ? postByUrn(ctx, named) : undefined;
  const posted = made && mayManage(ctx, member, String(made.author)) ? named : '';
  const now = nowMs(ctx);
  const sign = await mediaSigner(ctx);
  const shown = postsBy(ctx, authors, member);
  const body: Body = (
    <>
      <GlobalNav member={member} active="home" />
      <main className="layout">
        <aside>
          <section className="card" aria-label="Your profile">
            <div className="card-body">
              <Avatar name={String(member.name)} kind="member" size={56} />
              <div className="update__name" style={{ marginTop: 8 }}>{String(member.name)}</div>
              {member._headline ? <div className="muted small">{String(member._headline)}</div> : null}
            </div>
          </section>
          {pages.length ? (
            <section className="card" aria-label="Pages you manage">
              <div className="card-body">
                <div className="muted small">Pages you manage</div>
                {pages.map((o) => <div key={String(o.id)}><a href={`/company/${String(o.vanityName)}/`}>{String(o.localizedName)}</a></div>)}
              </div>
            </section>
          ) : null}
        </aside>
        <div>
          {posted ? <div className="alert alert-success" role="status">Post successful. <a href={`/feed/update/${posted}/`}>View post</a></div> : null}
          {composing ? composer(ctx, member, pages, refused, typed) : shareBox(member)}
          {shown.map((p) => <Update key={String(p.id)} ctx={ctx} post={p} member={member} now={now} sign={sign} />)}
        </div>
        <aside />
      </main>
    </>
  );
  // no reload while the person is writing a post: it would take their draft and file away
  return page(ctx, 'Feed', body, refused ? 400 : 200, [], composing ? {} : whileProcessing(shown));
}

/** The share box at the top of the feed. */
function shareBox(member: Row): Body {
  return (
    <section className="card share-box" aria-label="Share box">
      <div className="share-box__open">
        <Avatar name={String(member.name)} kind="member" size={48} />
        <a className="share-box__trigger" href="/feed/?shareActive=true">Start a post</a>
      </div>
      <div className="share-box__actions">
        <a className="share-box__action" href="/feed/?shareActive=true&shareMedia=video">Video</a>
        <a className="share-box__action" href="/feed/?shareActive=true&shareMedia=image">Photo</a>
      </div>
    </section>
  );
}

/** The post composer: who it is posted as (the member, or a page they post for: Post as reopens the composer as the
 *  one chosen), its text, a photo or a video from the person's machine, who can see it (what the choice offers), and
 *  Post. */
function composer(ctx: HandlerContext, member: Row, pages: Row[], refused?: string, typed?: { actor: string; commentary: string; visibility: string; attached?: Draft }): Body {
  const person = `urn:li:person:${String(member.sub)}`;
  const asked = typed?.actor ?? field(ctx, 'actor');
  const actor = [person, ...pages.map((o) => `urn:li:organization:${String(o.id)}`)].includes(asked) ? asked : person;
  const shareMedia = field(ctx, 'shareMedia');
  const accept = shareMedia === 'video' ? 'video/*' : shareMedia === 'image' ? 'image/*' : 'image/*,video/*';
  const choices: Array<[string, string]> = [[person, String(member.name)], ...pages.map((o): [string, string] => [`urn:li:organization:${String(o.id)}`, String(o.localizedName)])];
  return (
    <section className="card composer" aria-label="Create a post">
      <h2>Create a post</h2>
      {refused ? <div className="alert alert-error" role="alert">{refused}</div> : null}
      <form method="post" action={`/feed/?shareActive=true${shareMedia ? `&shareMedia=${encodeURIComponent(shareMedia)}` : ''}`} encType="multipart/form-data">
        {/* Post as: choosing another keeps what was typed and attached (the form is sent, and the composer drawn again) */}
        <fieldset aria-label="Post as" className="composer__as">
          <span className="muted small">Post as </span>
          {choices.map(([urn, name]) => (urn === actor
            ? <strong key={urn} className="choice" aria-current="true">{name}</strong>
            : <button key={urn} type="submit" name="as" value={urn} formNoValidate className="choice btn btn-tertiary">{name}</button>))}
        </fieldset>
        <input type="hidden" name="actor" value={actor} />
        {typed?.attached ? (
          <>
            <input type="hidden" name="attached" value={typed.attached.key} />
            <input type="hidden" name="attached-name" value={typed.attached.name} />
            <input type="hidden" name="attached-type" value={typed.attached.type} />
            <div className="muted small" role="status">{`${typed.attached.name} is attached`}</div>
          </>
        ) : null}
        {/* the share box takes what a post takes: Where the documentation stops, the number is the UGC Post API's */}
        <textarea name="commentary" aria-label="Text editor for creating content" placeholder="What do you want to talk about?" maxLength={COMMENTARY_MAX} defaultValue={typed?.commentary ?? ''} />
        <div className="composer__bar">
          <label>Add media <input type="file" name="media" accept={accept} /></label>
          <select name="visibility" aria-label="Who can see your post?" defaultValue={typed?.visibility ?? 'PUBLIC'}>
            {audiencesFor(actor).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <span className="spacer" />
          <a className="btn btn-tertiary" href="/feed/">Dismiss</a>
          <button type="submit" className="btn btn-primary">Post</button>
        </div>
      </form>
    </section>
  );
}

/** What a refused operation said. */
async function said(res: Response): Promise<string> {
  try { return String(((await res.json()) as { message?: unknown }).message ?? 'Something went wrong.'); } catch { return 'Something went wrong.'; }
}

/** The composer's Post: the media uploaded, then the post made, as the member through LinkedIn's own operations. */
async function share(ctx: HandlerContext, member: Row): Promise<Response> {
  const parts = await ctx.parts();
  const text = (name: string): string => new TextDecoder().decode(parts.find((p) => p.name === name && p.filename === null)?.body ?? new Uint8Array(0));
  const person = `urn:li:person:${String(member.sub)}`;
  // its line breaks as a post keeps them, and who may see it as the composer offers (../semantics/shared.ts)
  const file = parts.find((p) => p.name === 'media' && p.filename && p.body.length > 0);
  const kept = text('attached');
  const held = /^[A-Za-z0-9_-]+$/.test(kept) ? await ctx.blobs.get(`draft/${String(member.sub)}/${kept}`) : null;
  // Post as another: the composer again as that one, the draft (and a file just attached, kept for it) carried over,
  // who may see it what that one is offered
  const as = text('as');
  const attached: Draft | undefined = file && as ? await keepDraft(ctx, member, file) : held && !file ? { key: kept, name: text('attached-name'), type: text('attached-type') } : undefined;
  const typed = { actor: text('actor') || person, commentary: typedText(text('commentary')), visibility: text('visibility') || 'PUBLIC', ...(attached ? { attached } : {}) };
  if (as) return feed(ctx, member, undefined, { ...typed, actor: as, visibility: audiencesFor(as)[0]![0] });
  // the composer offers only who the member may post as, and only who may see a post as that one: a form that names
  // another is no browser's on this composer
  if (!audiencesFor(typed.actor).some(([value]) => value === typed.visibility)) return notOffered(ctx, member, typed);
  const bytes = file?.body ?? held ?? undefined;
  if (!typed.commentary.trim() && !bytes) return feed(ctx, member, 'Add some text, a photo or a video to post.', typed);
  const who = memberCaller(member);
  let media: Row | undefined;
  if (bytes) {
    const made = await upload(ctx, who, typed.actor, bytes);
    if (made instanceof Response) return feed(ctx, member, await said(made), typed);
    if (typeof made === 'string') return feed(ctx, member, made, typed);
    media = made;
  }
  const post = await createPostAs(ctx, who, {
    author: typed.actor, commentary: littleText(typed.commentary), visibility: typed.visibility,
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false, ...(media ? { content: { media } } : {}),
  });
  if (post instanceof Response) return feed(ctx, member, await said(post), typed);
  // posted: the draft's file is the post's media now, kept as LinkedIn keeps it, and the draft goes
  if (held) await ctx.blobs.remove(`draft/${String(member.sub)}/${kept}`);
  return seeOther(ctx, `/feed/?posted=${encodeURIComponent(post)}`);
}

/** A file attached and not yet posted, kept under the member while they change who the post is posted as. */
async function keepDraft(ctx: HandlerContext, member: Row, file: { body: Uint8Array; filename: string | null; type?: string | null }): Promise<Draft> {
  const key = ctx.crypto.digest('sha256', file.body, 'base64url');
  await ctx.blobs.put(`draft/${String(member.sub)}/${key}`, file.body);
  return { key, name: file.filename ?? 'file', type: file.type ?? '' };
}

/** A visibility the composer does not offer for who the post is posted as (a page's post visible to its "connections"),
 *  refused in the composer's words. */
function notOffered(ctx: HandlerContext, member: Row, typed: { actor: string; commentary: string; visibility: string; attached?: Draft }): Promise<Response> {
  return feed(ctx, member, 'Choose who can see your post from the options shown.', { ...typed, visibility: 'PUBLIC' });
}

/** A photo or a video from the person's machine uploaded for the post's author: the content's media, LinkedIn's
 *  refusal, or the composer's own words for a file that is neither. */
async function upload(ctx: HandlerContext, who: ReturnType<typeof memberCaller>, owner: string, bytes: Uint8Array): Promise<Row | Response | string> {
  // what the share box takes, by the file's bytes, whatever type the browser named (../semantics/shared.ts shareBoxKind)
  const kind = shareBoxKind(bytes);
  if (!kind) return 'That file type isn’t supported. Choose a photo or a video.';
  if (kind === 'image') {
    const value = await startImageUpload(ctx, who, { initializeUploadRequest: { owner } });
    if (value instanceof Response) return value;
    const refused = await putImage(ctx, String(urnOf(value.image)?.id), new URL(String(value.uploadUrl)).searchParams.get('ut'), bytes, 'share-box');
    return refused ?? { id: value.image };
  }
  const value = await startVideoUpload(ctx, who, { initializeUploadRequest: { owner, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false } });
  if (value instanceof Response) return value;
  const asset = String(urnOf(value.video)?.id);
  const etags: string[] = [];
  for (const part of value.uploadInstructions as Row[]) {
    const etag = await putVideoPart(ctx, asset, new URL(String(part.uploadUrl)).searchParams.get('sau'), bytes.subarray(Number(part.firstByte), Number(part.lastByte) + 1));
    if (etag instanceof Response) return etag;
    etags.push(etag);
  }
  const refused = await finishVideoUpload(ctx, who, { finalizeUploadRequest: { video: value.video, uploadToken: value.uploadToken, uploadedPartIds: etags } });
  return refused ?? { id: value.video };
}
